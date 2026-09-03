import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { Entity } from "./types"
import { matchText } from "./matcher"

const seedPath = fileURLToPath(
  new URL("../../../apps/api/data/lexicon.seed.json", import.meta.url),
)
const entities = JSON.parse(readFileSync(seedPath, "utf8")) as Entity[]

describe("matchText", () => {
  it.each([
    ["桀溺", "杰尼龟"],
    ["才问", "菜问"],
    ["主流", "猪柳蛋堡"],
    ["书并", "薯饼"],
    ["击退暴", "鸡腿堡"],
  ])("matches %s to %s", async (source, entity) => {
    const result = await matchText(`这句话里有${source}几个字`, entities)
    expect(result.hits.some((hit) => hit.entity.displayName === entity)).toBe(true)
  })

  it("matches across whitespace but not punctuation", async () => {
    expect((await matchText("书\n并", entities)).hits).toHaveLength(1)
    expect((await matchText("书，并", entities)).hits).toHaveLength(0)
  })

  it("returns UTF-16 offsets even when emoji appears first", async () => {
    const text = "🙂小海读书并写字"
    const hit = (await matchText(text, entities)).hits.find(
      (item) => item.entity.id === "hash-brown",
    )
    expect(hit).toBeDefined()
    expect(text.slice(hit!.start, hit!.end)).toBe("书并")
  })

  it("prefers different glyphs over exact entity mentions", async () => {
    const result = await matchText("主流和猪柳都出现了", entities)
    const source = result.hits.find((hit) => hit.surface === "主流")
    const exact = result.hits.find((hit) => hit.surface === "猪柳")
    expect(source!.score).toBeGreaterThan(exact!.score)
  })
})
