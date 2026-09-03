import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it, vi } from "vitest"

import {
  matchText,
  type Entity,
  type OcrResponse,
} from "../../../packages/core/src/index"
import { createApp } from "./app"
import type { LexiconRepository } from "./lexicon-repository"
import {
  MockOcrProvider,
  OcrProviderError,
  type OcrProvider,
} from "./ocr-provider"

const seedPath = fileURLToPath(
  new URL("../data/lexicon.seed.json", import.meta.url),
)
const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Entity[]

class MemoryRepository implements LexiconRepository {
  entities = structuredClone(seed)
  async list() {
    return structuredClone(this.entities)
  }
  async create(entity: Entity) {
    this.entities.push(entity)
    return entity
  }
  async upsertMany(entities: Entity[]) {
    let created = 0
    let updated = 0
    for (const entity of entities) {
      const index = this.entities.findIndex(
        (item) =>
          item.id === entity.id ||
          (item.displayName === entity.displayName && item.pack === entity.pack),
      )
      if (index < 0) {
        this.entities.push(entity)
        created += 1
      } else {
        this.entities[index] = entity
        updated += 1
      }
    }
    return { created, updated }
  }
  async update(id: string, patch: Partial<Entity>) {
    const index = this.entities.findIndex((entity) => entity.id === id)
    if (index < 0) return null
    this.entities[index] = { ...this.entities[index], ...patch }
    return this.entities[index]
  }
  async remove(id: string) {
    const before = this.entities.length
    this.entities = this.entities.filter((entity) => entity.id !== id)
    return this.entities.length < before
  }
  async reset() {
    this.entities = structuredClone(seed)
    return this.entities
  }
}

const ocr: OcrProvider = {
  name: "mock",
  async recognize(): Promise<OcrResponse> {
    return {
      text: "小海读书并写下感言",
      lines: [{ text: "小海读书并写下感言", start: 0, end: 10 }],
      provider: "mock",
      orientation: "horizontal",
      demo: true,
    }
  },
}

describe("API", () => {
  it("returns matching entities", async () => {
    const app = createApp(new MemoryRepository(), ocr)
    const response = await app.request("/v1/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "小海读书并写下感言" }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.hits[0].entity.id).toBe("hash-brown")
    expect(body.data.hits[0].entity.triggers).toBeUndefined()
  })

  it("recognizes a valid demo image upload", async () => {
    const app = createApp(new MemoryRepository(), ocr)
    const form = new FormData()
    form.set(
      "image",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], "demo.jpg", {
        type: "image/jpeg",
      }),
    )
    form.set("demoId", "shu-bing")
    const response = await app.request("/v1/ocr", {
      method: "POST",
      body: form,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.text).toContain("书并")
  })

  it("does not expose the lexicon on the public API", async () => {
    const app = createApp(new MemoryRepository(), ocr, {
      adminToken: "secret",
    })
    expect((await app.request("/v1/entities")).status).toBe(404)
    expect((await app.request("/admin/v1/entities")).status).toBe(401)
    expect(
      (
        await app.request("/admin/v1/entities", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401)
    const response = await app.request("/admin/v1/entities", {
      headers: { authorization: "Bearer secret" },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toHaveLength(5)
  })

  it("syncs a catalog source only through the admin API", async () => {
    const repository = new MemoryRepository()
    const app = createApp(repository, ocr, { adminToken: "secret" })
    const denied = await app.request(
      "/admin/v1/catalog/sources/pokemon/sync",
      { method: "POST", body: JSON.stringify({ limit: 3 }) },
    )
    expect(denied.status).toBe(401)
    const response = await app.request(
      "/admin/v1/catalog/sources/pokemon/sync",
      {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 3 }),
      },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ source: "pokemon", fetched: 3, created: 3 })
  })

  it("proxies images by entity id without exposing source URLs", async () => {
    const imageFetcher = vi.fn<typeof fetch>(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
    })
    const app = createApp(new MemoryRepository(), ocr, {
      fetcher: imageFetcher,
      publicWebUrl: "https://public.pages.dev",
    })
    const response = await app.request("/v1/images/hash-brown")
    expect(response.status).toBe(200)
    expect(imageFetcher).toHaveBeenCalledWith(
      new URL("https://public.pages.dev/entities/hash-brown-photo.webp"),
    )
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800")
  })
})

describe("demo OCR integrity", () => {
  const provider = new MockOcrProvider()

  it.each([
    ["jie-ni", "squirtle"],
    ["cai-wen", "bonk-choy"],
    ["zhu-liu", "pork-muffin"],
    ["shu-bing", "hash-brown"],
    ["ji-tui-bao", "chicken-burger"],
  ])("only returns candidates present in %s input", async (demoId, entityId) => {
    const result = await provider.recognize({
      bytes: new Uint8Array([0xff, 0xd8]),
      mimeType: "image/jpeg",
      demoId,
    })
    const matchedIds = new Set(
      (await matchText(result.text, seed)).hits.map((hit) => hit.entity.id),
    )
    expect([...matchedIds]).toEqual([entityId])
  })

  it("does not support a fabricated multi-result image", async () => {
    await expect(
      provider.recognize({
        bytes: new Uint8Array([0xff, 0xd8]),
        mimeType: "image/jpeg",
        demoId: "all",
      }),
    ).rejects.toBeInstanceOf(OcrProviderError)
  })
})
