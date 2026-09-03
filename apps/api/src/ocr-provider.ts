import { createHash, createHmac } from "node:crypto"

import type { OcrResponse } from "../../../packages/core/src/index"

export type OcrInput = {
  bytes: Uint8Array
  mimeType: string
  demoId?: string
  orientation?: "horizontal" | "vertical"
}

export interface OcrProvider {
  readonly name: "mock" | "tencent"
  recognize(input: OcrInput): Promise<OcrResponse>
}

const DEMO_LINES: Record<
  string,
  Array<{
    text: string
    box: { x: number; y: number; width: number; height: number }
  }>
> = {
  "jie-ni": [
    {
      text: "子路遇见桀溺以后，继续向前赶路。",
      box: { x: 110, y: 220, width: 850, height: 68 },
    },
  ],
  "cai-wen": [
    {
      text: "许久平静下来才问，那我什么时候出发？",
      box: { x: 110, y: 220, width: 960, height: 68 },
    },
  ],
  "zhu-liu": [
    {
      text: "这种做法现在已经成为主流。",
      box: { x: 110, y: 220, width: 750, height: 68 },
    },
  ],
  "shu-bing": [
    {
      text: "小海近期读书并写下了感言。",
      box: { x: 110, y: 220, width: 750, height: 68 },
    },
  ],
  "ji-tui-bao": [
    {
      text: "大侠终于击退暴走野猪。",
      box: { x: 110, y: 220, width: 650, height: 68 },
    },
  ],
}

export class MockOcrProvider implements OcrProvider {
  readonly name = "mock" as const

  async recognize(input: OcrInput): Promise<OcrResponse> {
    const fixtureLines = input.demoId ? DEMO_LINES[input.demoId] : undefined
    if (!fixtureLines) {
      throw new OcrProviderError(
        "OCR_NOT_CONFIGURED",
        "在线 OCR 尚未配置。请选择内置样例体验，或直接粘贴文字；填入腾讯云密钥后即可识别任意图片。",
        false,
      )
    }
    let offset = 0
    const lines = fixtureLines.map((line) => {
      const start = offset
      const end = start + line.text.length
      offset = end + 1
      return { ...line, start, end, confidence: 0.99 }
    })
    return {
      text: lines.map((line) => line.text).join("\n"),
      lines,
      provider: "mock",
      orientation: input.orientation ?? "horizontal",
      confidence: 0.99,
      demo: true,
    }
  }
}

type TencentOcrResponse = {
  Response?: {
    TextDetections?: Array<{
      DetectedText?: string
      Confidence?: number
      ItemPolygon?: {
        X?: number
        Y?: number
        Width?: number
        Height?: number
      }
    }>
    Error?: {
      Code?: string
      Message?: string
    }
    RequestId?: string
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function hmac(value: string, key: string | Buffer): Buffer
function hmac(value: string, key: string | Buffer, encoding: "hex"): string
function hmac(
  value: string,
  key: string | Buffer,
  encoding?: "hex",
): Buffer | string {
  const digest = createHmac("sha256", key).update(value)
  return encoding ? digest.digest(encoding) : digest.digest()
}

function utcDate(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

export function inferTextOrientation(
  lines: OcrResponse["lines"],
): OcrResponse["orientation"] {
  let horizontal = 0
  let vertical = 0
  for (const line of lines) {
    if (!line.box) continue
    const weight = Math.max(1, Array.from(line.text).length)
    if (line.box.width > line.box.height * 1.25) horizontal += weight
    if (line.box.height > line.box.width * 1.25) vertical += weight
  }
  if (horizontal === vertical) return "unknown"
  return horizontal > vertical ? "horizontal" : "vertical"
}

export class TencentOcrProvider implements OcrProvider {
  readonly name = "tencent" as const
  private readonly endpoint = "ocr.tencentcloudapi.com"
  private readonly service = "ocr"
  private readonly action = "GeneralBasicOCR"
  private readonly version = "2018-11-19"

  constructor(
    private readonly secretId: string,
    private readonly secretKey: string,
    private readonly region = "ap-guangzhou",
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async recognize(input: OcrInput): Promise<OcrResponse> {
    const timestamp = this.now()
    const date = utcDate(timestamp)
    const payload = JSON.stringify({
      ImageBase64: Buffer.from(input.bytes).toString("base64"),
      LanguageType: "zh",
    })
    const contentType = "application/json; charset=utf-8"
    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${this.endpoint}\n` +
      `x-tc-action:${this.action.toLowerCase()}\n`
    const signedHeaders = "content-type;host;x-tc-action"
    const canonicalRequest = [
      "POST",
      "/",
      "",
      canonicalHeaders,
      signedHeaders,
      sha256(payload),
    ].join("\n")
    const credentialScope = `${date}/${this.service}/tc3_request`
    const stringToSign = [
      "TC3-HMAC-SHA256",
      String(timestamp),
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n")
    const dateKey = hmac(date, `TC3${this.secretKey}`)
    const serviceKey = hmac(this.service, dateKey)
    const signingKey = hmac("tc3_request", serviceKey)
    const signature = hmac(stringToSign, signingKey, "hex")
    const authorization =
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`

    const response = await this.fetcher(`https://${this.endpoint}`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": contentType,
        "x-tc-action": this.action,
        "x-tc-region": this.region,
        "x-tc-timestamp": String(timestamp),
        "x-tc-version": this.version,
      },
      body: payload,
    })

    if (!response.ok) {
      throw new OcrProviderError(
        "OCR_UPSTREAM_ERROR",
        `腾讯云 OCR 请求失败（${response.status}）`,
        response.status >= 500 || response.status === 429,
      )
    }

    const payloadResult = (await response.json()) as TencentOcrResponse
    const result = payloadResult.Response
    if (result?.Error) {
      const retryable =
        result.Error.Code?.includes("RequestLimitExceeded") === true ||
        result.Error.Code?.includes("InternalError") === true
      throw new OcrProviderError(
        result.Error.Code ?? "OCR_UPSTREAM_ERROR",
        result.Error.Message ?? "腾讯云 OCR 请求失败",
        retryable,
      )
    }

    const detections = result?.TextDetections ?? []
    const detectedLines = detections
      .map((item) => item.DetectedText?.trim())
      .filter((text): text is string => Boolean(text))
    if (!detectedLines.length) {
      throw new OcrProviderError(
        "OCR_NO_TEXT",
        "图片中没有识别到文字，请换一张更清晰的图片或直接修改文字。",
        false,
      )
    }
    const confidenceValues = detections
      .map((item) => item.Confidence)
      .filter((value): value is number => typeof value === "number")
    const confidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length /
        100
      : undefined
    let offset = 0
    const lines = detections
      .filter((item) => item.DetectedText?.trim())
      .map((item) => {
        const text = item.DetectedText!.trim()
        const start = offset
        const end = start + text.length
        offset = end + 1
        const polygon = item.ItemPolygon
        return {
          text,
          start,
          end,
          confidence:
            typeof item.Confidence === "number"
              ? item.Confidence / 100
              : undefined,
          box:
            typeof polygon?.X === "number" &&
            typeof polygon.Y === "number" &&
            typeof polygon.Width === "number" &&
            typeof polygon.Height === "number"
              ? {
                  x: polygon.X,
                  y: polygon.Y,
                  width: polygon.Width,
                  height: polygon.Height,
                }
              : undefined,
        }
      })

    return {
      text: detectedLines.join("\n"),
      lines,
      provider: "tencent",
      orientation: inferTextOrientation(lines),
      confidence,
      demo: false,
    }
  }
}

export class OcrProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
  }
}

type OcrEnvironment = {
  OCR_PROVIDER?: string
  TENCENTCLOUD_SECRET_ID?: string
  TENCENTCLOUD_SECRET_KEY?: string
  TENCENTCLOUD_REGION?: string
}

export function createOcrProvider(
  env: OcrEnvironment = process.env as OcrEnvironment,
) {
  const provider = env.OCR_PROVIDER ?? "mock"
  if (
    provider === "tencent" &&
    env.TENCENTCLOUD_SECRET_ID &&
    env.TENCENTCLOUD_SECRET_KEY
  ) {
    return new TencentOcrProvider(
      env.TENCENTCLOUD_SECRET_ID,
      env.TENCENTCLOUD_SECRET_KEY,
      env.TENCENTCLOUD_REGION ?? "ap-guangzhou",
    )
  }
  return new MockOcrProvider()
}
