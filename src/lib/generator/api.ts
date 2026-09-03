import type {
  ApiEnvelope,
  MatchResponse,
  OcrResponse,
} from "@meme/core"

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:43128"

function apiUrl(path: string) {
  return `${API_BASE_URL.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`
}

function apiAssetUrl(value: string) {
  const url = new URL(value, "http://api.local")
  return apiUrl(`${url.pathname}${url.search}`)
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message)
  }
}

async function unwrap<T>(response: Response) {
  const body = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || body.error || !body.data) {
    throw new ApiClientError(
      body.error?.message ?? "请求失败，请稍后再试。",
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.retryable ?? response.status >= 500,
    )
  }
  return body.data
}

export async function getHealth() {
  return unwrap<{
    status: string
    ocrProvider: string
    ocrConfigured: boolean
  }>(await fetch(apiUrl("/v1/health"), { cache: "no-store" }))
}

export async function recognizeImage(options: {
  image: Blob
  fileName: string
  demoId?: string
}) {
  const form = new FormData()
  form.set("image", options.image, options.fileName)
  if (options.demoId) form.set("demoId", options.demoId)
  return unwrap<OcrResponse>(
    await fetch(apiUrl("/v1/ocr"), {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: form,
    }),
  )
}

export async function findMatches(text: string) {
  const result = await unwrap<MatchResponse>(
    await fetch(apiUrl("/v1/matches"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  )
  return {
    ...result,
    hits: result.hits.map((hit) => ({
      ...hit,
      entity: {
        ...hit.entity,
        imageUrl: apiAssetUrl(hit.entity.imageUrl),
      },
    })),
  }
}
