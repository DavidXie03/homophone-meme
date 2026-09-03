import { cors } from "hono/cors"
import { Hono } from "hono"
import { z } from "zod"

import {
  matchText,
  type ApiEnvelope,
  type Entity,
  type OcrResponse,
} from "../../../packages/core/src/index"
import type { LexiconRepository } from "./lexicon-repository"
import {
  createOcrProvider,
  OcrProviderError,
  type OcrProvider,
} from "./ocr-provider"
import {
  defaultCatalogSources,
  listCatalogSources,
  type CatalogSource,
  type CatalogSourceId,
} from "./catalog-sources"

const triggerSchema = z.object({
  text: z.string().trim().min(2).max(6),
  kind: z.enum(["full", "alias", "prefix", "manual"]).default("manual"),
  weight: z.number().min(0).max(100).default(10),
})

const entityInputSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  pack: z.string().trim().min(1).max(40),
  category: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).default(""),
  imageUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.startsWith("/") || /^https?:\/\//u.test(value), {
      message: "图片地址必须是站内路径或 HTTP(S) 地址",
    }),
  source: z.string().trim().max(100).default("手工录入"),
  licenseStatus: z
    .enum(["prototype", "licensed", "open", "unknown"])
    .default("unknown"),
  enabled: z.boolean().default(true),
  popularity: z.number().min(0).max(100).default(50),
  triggers: z.array(triggerSchema).min(1).max(12),
})

const matchInputSchema = z.object({
  text: z.string().min(1).max(2000),
})

const rateLimit = new Map<string, { count: number; resetAt: number }>()

function envelope<T>(
  data: T | null,
  requestId: string,
  error: ApiEnvelope<T>["error"] = null,
): ApiEnvelope<T> {
  return { data, error, requestId }
}

function slugify(text: string) {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-|-$/gu, "")
  return `${ascii || "entity"}-${crypto.randomUUID().slice(0, 8)}`
}

function isAllowedImage(bytes: Uint8Array) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  return jpeg || png || webp
}

async function verifyTurnstile(
  token: string | null,
  ip: string,
  secret?: string,
) {
  if (!secret) return true
  if (!token) return false
  const body = new FormData()
  body.set("secret", secret)
  body.set("response", token)
  body.set("remoteip", ip)
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  )
  const result = (await response.json()) as { success?: boolean }
  return result.success === true
}

function allowOcr(ip: string) {
  const now = Date.now()
  const state = rateLimit.get(ip)
  if (!state || state.resetAt <= now) {
    rateLimit.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (state.count >= 20) return false
  state.count += 1
  return true
}

export function createApp(
  repository: LexiconRepository,
  ocrProvider: OcrProvider = createOcrProvider(),
  options: {
    adminToken?: string
    catalogSources?: Record<CatalogSourceId, CatalogSource>
    fetcher?: typeof fetch
    publicWebUrl?: string
    webOrigins?: string
    adminOrigins?: string
    turnstileSecret?: string
  } = {},
) {
  const app = new Hono()
  const allowedOrigins = (
    `${options.webOrigins ?? process.env.WEB_ORIGINS ?? "http://127.0.0.1:43127,http://localhost:43127"},${options.adminOrigins ?? process.env.ADMIN_ORIGINS ?? "http://127.0.0.1:43129,http://localhost:43129"}`
  ).split(",")
  const adminToken = options.adminToken ?? process.env.ADMIN_API_TOKEN
  const catalogSources = options.catalogSources ?? defaultCatalogSources
  const imageFetcher = options.fetcher ?? fetch
  const publicWebUrl =
    options.publicWebUrl ??
    process.env.PUBLIC_WEB_URL ??
    "http://127.0.0.1:43127"

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-Turnstile-Token",
        "X-Idempotency-Key",
      ],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 3600,
    }),
  )

  app.use("/admin/v1/*", async (c, next) => {
    const provided = c.req.header("authorization")
    if (!adminToken || provided !== `Bearer ${adminToken}`) {
      return c.json(
        envelope(null, crypto.randomUUID(), {
          code: "ADMIN_UNAUTHORIZED",
          message: "管理凭证无效",
          retryable: false,
        }),
        401,
      )
    }
    await next()
  })

  app.get("/v1/health", async (c) => {
    const requestId = crypto.randomUUID()
    return c.json(
      envelope(
        {
          status: "ok",
          ocrProvider: ocrProvider.name,
          ocrConfigured: ocrProvider.name !== "mock",
        },
        requestId,
      ),
    )
  })

  app.get("/admin/v1/entities", async (c) => {
    const requestId = crypto.randomUUID()
    return c.json(envelope(await repository.list(), requestId))
  })

  app.post("/admin/v1/entities", async (c) => {
    const requestId = crypto.randomUUID()
    const parsed = entityInputSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        envelope(null, requestId, {
          code: "INVALID_ENTITY",
          message: parsed.error.issues[0]?.message ?? "词条格式不正确",
          retryable: false,
        }),
        400,
      )
    }
    const now = new Date().toISOString()
    const id = slugify(parsed.data.displayName)
    const entity: Entity = {
      ...parsed.data,
      id,
      triggers: parsed.data.triggers.map((trigger, index) => ({
        ...trigger,
        id: `${id}-trigger-${index + 1}`,
      })),
      createdAt: now,
      updatedAt: now,
    }
    return c.json(envelope(await repository.create(entity), requestId), 201)
  })

  app.patch("/admin/v1/entities/:id", async (c) => {
    const requestId = crypto.randomUUID()
    const current = (await repository.list()).find(
      (entity) => entity.id === c.req.param("id"),
    )
    if (!current) {
      return c.json(
        envelope(null, requestId, {
          code: "NOT_FOUND",
          message: "没有找到这个实体",
          retryable: false,
        }),
        404,
      )
    }
    const parsed = entityInputSchema.safeParse({
      ...current,
      ...(await c.req.json()),
    })
    if (!parsed.success) {
      return c.json(
        envelope(null, requestId, {
          code: "INVALID_ENTITY",
          message: parsed.error.issues[0]?.message ?? "词条格式不正确",
          retryable: false,
        }),
        400,
      )
    }
    const entity = await repository.update(current.id, {
      ...parsed.data,
      triggers: parsed.data.triggers.map((trigger, index) => ({
        ...trigger,
        id: current.triggers[index]?.id ?? `${current.id}-trigger-${index + 1}`,
      })),
    })
    return c.json(envelope(entity, requestId))
  })

  app.delete("/admin/v1/entities/:id", async (c) => {
    const requestId = crypto.randomUUID()
    const removed = await repository.remove(c.req.param("id"))
    return c.json(envelope({ removed }, requestId), removed ? 200 : 404)
  })

  app.post("/admin/v1/entities/reset", async (c) => {
    const requestId = crypto.randomUUID()
    return c.json(envelope(await repository.reset(), requestId))
  })

  app.get("/admin/v1/catalog/sources", (c) => {
    return c.json(
      envelope(listCatalogSources(catalogSources), crypto.randomUUID()),
    )
  })

  app.post("/admin/v1/catalog/sources/:id/sync", async (c) => {
    const requestId = crypto.randomUUID()
    const source = catalogSources[c.req.param("id") as CatalogSourceId]
    if (!source) {
      return c.json(
        envelope(null, requestId, {
          code: "CATALOG_SOURCE_NOT_FOUND",
          message: "数据源不存在",
          retryable: false,
        }),
        404,
      )
    }
    const input = (await c.req.json().catch(() => ({}))) as { limit?: number }
    const limit = Math.max(
      1,
      Math.min(500, Math.floor(input.limit ?? source.defaultLimit)),
    )
    try {
      const entities = await source.sync(limit)
      const result = await repository.upsertMany(entities)
      return c.json(
        envelope(
          {
            source: source.id,
            fetched: entities.length,
            ...result,
          },
          requestId,
        ),
      )
    } catch (error) {
      return c.json(
        envelope(null, requestId, {
          code: "CATALOG_SYNC_FAILED",
          message: error instanceof Error ? error.message : "同步失败",
          retryable: true,
        }),
        502,
      )
    }
  })

  app.get("/v1/images/:id", async (c) => {
    const entity = (await repository.list()).find(
      (item) => item.id === c.req.param("id") && item.enabled,
    )
    if (!entity) return c.notFound()
    const sourceUrl = entity.imageUrl.startsWith("/")
      ? new URL(entity.imageUrl, publicWebUrl).toString()
      : entity.imageUrl
    let url: URL
    try {
      url = new URL(sourceUrl)
      if (!["http:", "https:"].includes(url.protocol)) return c.notFound()
    } catch {
      return c.notFound()
    }
    const response = await imageFetcher(url)
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || !contentType.startsWith("image/")) return c.notFound()
    return new Response(response.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=604800",
      },
    })
  })

  app.post("/v1/matches", async (c) => {
    const requestId = crypto.randomUUID()
    const parsed = matchInputSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        envelope(null, requestId, {
          code: "INVALID_TEXT",
          message: "请输入 1–2000 个字符",
          retryable: false,
        }),
        400,
      )
    }
    const result = await matchText(parsed.data.text, await repository.list())
    return c.json(
      envelope(
        {
          ...result,
          hits: result.hits.map((hit) => ({
            ...hit,
            entity: {
              id: hit.entity.id,
              displayName: hit.entity.displayName,
              pack: hit.entity.pack,
              imageUrl: new URL(
                `/v1/images/${encodeURIComponent(hit.entity.id)}`,
                c.req.url,
              ).toString(),
            },
          })),
        },
        requestId,
      ),
    )
  })

  app.post("/v1/ocr", async (c) => {
    const requestId = crypto.randomUUID()
    const ip = c.req.header("cf-connecting-ip") ?? "local"
    if (!allowOcr(ip)) {
      return c.json(
        envelope<OcrResponse>(null, requestId, {
          code: "OCR_RATE_LIMITED",
          message: "识别得太快了，请一分钟后再试。",
          retryable: true,
        }),
        429,
      )
    }
    if (
      !(await verifyTurnstile(
        c.req.header("x-turnstile-token") ?? null,
        ip,
        options.turnstileSecret ?? process.env.TURNSTILE_SECRET_KEY,
      ))
    ) {
      return c.json(
        envelope<OcrResponse>(null, requestId, {
          code: "TURNSTILE_FAILED",
          message: "安全校验失败，请刷新后再试。",
          retryable: true,
        }),
        403,
      )
    }

    const form = await c.req.raw.formData()
    const file = form.get("image")
    const demoId = String(form.get("demoId") ?? "")

    if (!(file instanceof File) || file.size > 6 * 1024 * 1024) {
      return c.json(
        envelope<OcrResponse>(null, requestId, {
          code: "INVALID_IMAGE",
          message: "请选择压缩后不超过 6MB 的 JPG、PNG 或 WebP 图片。",
          retryable: false,
        }),
        400,
      )
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!isAllowedImage(bytes)) {
      return c.json(
        envelope<OcrResponse>(null, requestId, {
          code: "INVALID_IMAGE_TYPE",
          message: "图片格式不受支持，请使用 JPG、PNG 或 WebP。",
          retryable: false,
        }),
        400,
      )
    }

    try {
      const result = await ocrProvider.recognize({
        bytes,
        mimeType: file.type,
        demoId: demoId || undefined,
      })
      return c.json(envelope(result, requestId))
    } catch (error) {
      if (!(error instanceof OcrProviderError)) {
        console.error(
          "Unexpected OCR error",
          error instanceof Error ? error.message : String(error),
        )
      }
      const known =
        error instanceof OcrProviderError
          ? error
          : new OcrProviderError(
              "OCR_FAILED",
              "识别服务暂时不可用，请稍后再试。",
              true,
            )
      return c.json(
        envelope<OcrResponse>(null, requestId, {
          code: known.code,
          message: known.message,
          retryable: known.retryable,
        }),
        known.code === "OCR_NOT_CONFIGURED" ? 503 : 502,
      )
    }
  })

  app.notFound((c) =>
    c.json(
      envelope(null, crypto.randomUUID(), {
        code: "NOT_FOUND",
        message: "接口不存在",
        retryable: false,
      }),
      404,
    ),
  )

  return app
}
