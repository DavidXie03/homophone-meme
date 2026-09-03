export type TriggerKind = "full" | "alias" | "prefix" | "manual"

export type Trigger = {
  id: string
  text: string
  kind: TriggerKind
  weight: number
}

export type Entity = {
  id: string
  displayName: string
  pack: string
  category: string
  description: string
  imageUrl: string
  source: string
  licenseStatus: "prototype" | "licensed" | "open" | "unknown"
  enabled: boolean
  popularity: number
  triggers: Trigger[]
  createdAt: string
  updatedAt: string
}

export type MatchHit = {
  id: string
  start: number
  end: number
  surface: string
  surfacePinyin: string
  trigger: Trigger
  triggerPinyin: string
  entity: Entity
  score: number
  toneSimilarity: number
  reasons: string[]
}

export type MatchResponse = {
  text: string
  hits: MatchHit[]
  meta: {
    scannedCharacters: number
    windows: number
    entities: number
  }
}

export type OcrLine = {
  text: string
  start: number
  end: number
  confidence?: number
  box?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type OcrResponse = {
  text: string
  lines: OcrLine[]
  provider: "mock" | "tencent"
  orientation: "horizontal" | "vertical" | "unknown"
  confidence?: number
  demo: boolean
}

export type ApiError = {
  code: string
  message: string
  retryable: boolean
}

export type ApiEnvelope<T> = {
  data: T | null
  error: ApiError | null
  requestId: string
}
