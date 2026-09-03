import { describe, expect, it, vi } from "vitest"

import {
  inferTextOrientation,
  OcrProviderError,
  TencentOcrProvider,
} from "./ocr-provider"

describe("TencentOcrProvider", () => {
  it("signs GeneralBasicOCR and normalizes detections", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        Response: {
          TextDetections: [
            {
              DetectedText: "小海读书并",
              Confidence: 98,
              ItemPolygon: { X: 10, Y: 20, Width: 200, Height: 40 },
            },
            {
              DetectedText: "写下了感言",
              Confidence: 94,
              ItemPolygon: { X: 10, Y: 70, Width: 180, Height: 40 },
            },
          ],
          RequestId: "request-id",
        },
      }),
    )
    const provider = new TencentOcrProvider(
      "AKIDEXAMPLE",
      "secret-key",
      "ap-guangzhou",
      fetcher,
      () => 1_788_318_000,
    )

    const result = await provider.recognize({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    })

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(String(url)).toBe("https://ocr.tencentcloudapi.com")
    expect(headers.get("x-tc-action")).toBe("GeneralBasicOCR")
    expect(headers.get("x-tc-version")).toBe("2018-11-19")
    expect(headers.get("x-tc-region")).toBe("ap-guangzhou")
    expect(headers.get("x-tc-timestamp")).toBe("1788318000")
    expect(headers.get("authorization")).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\/2026-09-02\/ocr\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[a-f0-9]{64}$/u,
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      ImageBase64: "/9j/",
      LanguageType: "zh",
    })
    expect(result).toMatchObject({
      provider: "tencent",
      text: "小海读书并\n写下了感言",
      confidence: 0.96,
      orientation: "horizontal",
      demo: false,
    })
    expect(result.lines).toEqual([
      {
        text: "小海读书并",
        start: 0,
        end: 5,
        confidence: 0.98,
        box: { x: 10, y: 20, width: 200, height: 40 },
      },
      {
        text: "写下了感言",
        start: 6,
        end: 11,
        confidence: 0.94,
        box: { x: 10, y: 70, width: 180, height: 40 },
      },
    ])
  })

  it("infers vertical text from OCR boxes", () => {
    expect(
      inferTextOrientation([
        {
          text: "竖排文字",
          start: 0,
          end: 4,
          box: { x: 10, y: 20, width: 40, height: 200 },
        },
      ]),
    ).toBe("vertical")
    expect(
      inferTextOrientation([
        {
          text: "字",
          start: 0,
          end: 1,
          box: { x: 10, y: 20, width: 40, height: 40 },
        },
      ]),
    ).toBe("unknown")
  })

  it("reports an empty OCR result", async () => {
    const provider = new TencentOcrProvider(
      "id",
      "key",
      "ap-guangzhou",
      async () => Response.json({ Response: { TextDetections: [] } }),
    )
    await expect(
      provider.recognize({
        bytes: new Uint8Array([0xff, 0xd8]),
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({
      code: "OCR_NO_TEXT",
    } satisfies Partial<OcrProviderError>)
  })

  it("preserves Tencent errors and retryability", async () => {
    const provider = new TencentOcrProvider(
      "id",
      "key",
      "ap-guangzhou",
      async () =>
        Response.json({
          Response: {
            Error: {
              Code: "RequestLimitExceeded",
              Message: "rate limited",
            },
          },
        }),
    )
    await expect(
      provider.recognize({
        bytes: new Uint8Array([0xff, 0xd8]),
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({
      code: "RequestLimitExceeded",
      retryable: true,
    } satisfies Partial<OcrProviderError>)
  })
})
