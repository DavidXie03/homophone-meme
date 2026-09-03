import { describe, expect, it } from "vitest"

import type { MatchHit, OcrResponse } from "@meme/core"
import { resolveOcrMatchBox } from "./composer"

const hit = {
  start: 2,
  end: 4,
  surface: "书并",
} as MatchHit

function ocr(orientation: OcrResponse["orientation"]): OcrResponse {
  return {
    text: "甲乙书并丙丁",
    lines: [
      {
        text: "甲乙书并丙丁",
        start: 0,
        end: 6,
        box: { x: 100, y: 200, width: 600, height: 60 },
      },
    ],
    provider: "mock",
    orientation,
    demo: true,
  }
}

describe("resolveOcrMatchBox", () => {
  it("maps a substring proportionally within a horizontal OCR line", () => {
    expect(resolveOcrMatchBox(ocr("horizontal"), hit)).toEqual({
      x: 300,
      y: 200,
      width: 200,
      height: 60,
    })
  })

  it("maps a substring proportionally within a vertical OCR line", () => {
    const vertical = ocr("vertical")
    vertical.lines[0].box = { x: 100, y: 100, width: 60, height: 600 }
    expect(resolveOcrMatchBox(vertical, hit)).toEqual({
      x: 100,
      y: 300,
      width: 60,
      height: 200,
    })
  })

  it("uses the OCR box shape when global orientation is unknown", () => {
    const vertical = ocr("unknown")
    vertical.lines[0].box = { x: 100, y: 100, width: 60, height: 600 }
    expect(resolveOcrMatchBox(vertical, hit)).toEqual({
      x: 100,
      y: 300,
      width: 60,
      height: 200,
    })
  })

  it("returns null when OCR did not provide coordinates", () => {
    const missing = ocr("horizontal")
    missing.lines[0].box = undefined
    expect(resolveOcrMatchBox(missing, hit)).toBeNull()
  })
})
