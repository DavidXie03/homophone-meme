import { describe, expect, it } from "vitest"

import type { MatchHit } from "@meme/core"
import { selectAutomaticHits } from "./selection"

function hit(
  id: string,
  start: number,
  end: number,
  score: number,
  surface = id,
) {
  return { id, start, end, score, surface } as MatchHit
}

describe("selectAutomaticHits", () => {
  it("drops low-confidence noise", () => {
    expect(
      selectAutomaticHits([
        hit("desired", 5, 7, 81),
        hit("noise", 0, 2, 43),
      ]).map((item) => item.id),
    ).toEqual(["desired"])
  })

  it("keeps the highest scoring overlap", () => {
    expect(
      selectAutomaticHits([
        hit("short", 2, 4, 80),
        hit("long", 2, 6, 100),
      ]).map((item) => item.id),
    ).toEqual(["long"])
  })

  it("keeps separate high-confidence matches", () => {
    expect(
      selectAutomaticHits([
        hit("first", 0, 2, 90),
        hit("second", 5, 8, 85),
      ]).map((item) => item.id),
    ).toEqual(["first", "second"])
  })

  it("keeps only the first occurrence of repeated text", () => {
    expect(
      selectAutomaticHits([
        hit("first-occurrence", 2, 4, 90, "书并"),
        hit("second-occurrence", 10, 12, 90, "书并"),
      ]).map((item) => item.id),
    ).toEqual(["first-occurrence"])
  })
})
