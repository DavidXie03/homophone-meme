import type { Entity, MatchHit, MatchResponse, Trigger } from "./types"

type PinyinApi = typeof import("pinyin-pro")
let pinyinApi: PinyinApi | null = null

type IndexedTrigger = {
  entity: Entity
  trigger: Trigger
  noTone: string
  tones: string[]
  syllableCount: number
}

type HanCharacter = {
  value: string
  start: number
  end: number
}

const HAN = /\p{Script=Han}/u

function primaryPinyin(text: string, toneType: "none" | "num") {
  return pinyinApi!.pinyin(text, { toneType, type: "array" }) as string[]
}

function pinyinKey(text: string) {
  return primaryPinyin(text, "none").join("-")
}

function toneSimilarity(left: string[], right: string[]) {
  if (!left.length || left.length !== right.length) return 0
  const equal = left.reduce((total, value, index) => {
    return total + (value === right[index] ? 1 : 0)
  }, 0)
  return equal / left.length
}

function pronunciationKeys(text: string) {
  const readings = pinyinApi!.polyphonic(text, {
    type: "array",
    toneType: "none",
  }) as string[][]

  const keys = new Set<string>()
  const walk = (index: number, current: string[]) => {
    if (keys.size >= 48) return
    if (index === readings.length) {
      keys.add(current.join("-"))
      return
    }
    for (const reading of readings[index] ?? []) {
      walk(index + 1, [...current, reading])
    }
  }
  walk(0, [])
  keys.add(pinyinKey(text))
  return keys
}

function buildRuns(text: string) {
  const runs: HanCharacter[][] = []
  let current: HanCharacter[] = []
  let utf16Offset = 0

  for (const value of Array.from(text)) {
    const start = utf16Offset
    utf16Offset += value.length
    if (HAN.test(value)) {
      current.push({ value, start, end: utf16Offset })
      continue
    }
    if (/\s/u.test(value)) continue
    if (current.length) runs.push(current)
    current = []
  }
  if (current.length) runs.push(current)
  return runs
}

function indexEntities(entities: Entity[]) {
  const byLengthAndPinyin = new Map<string, IndexedTrigger[]>()
  const lengths = new Set<number>()

  for (const entity of entities) {
    if (!entity.enabled) continue
    for (const trigger of entity.triggers) {
      const tones = primaryPinyin(trigger.text, "num")
      const noTone = primaryPinyin(trigger.text, "none").join("-")
      const syllableCount = tones.length
      if (syllableCount < 2 || syllableCount > 6) continue
      const item = { entity, trigger, noTone, tones, syllableCount }
      const key = `${syllableCount}:${noTone}`
      byLengthAndPinyin.set(key, [...(byLengthAndPinyin.get(key) ?? []), item])
      lengths.add(syllableCount)
    }
  }
  return {
    byLengthAndPinyin,
    lengths: [...lengths].sort((a, b) => b - a),
  }
}

function buildHit(
  chars: HanCharacter[],
  source: string,
  indexed: IndexedTrigger,
): MatchHit {
  const sourceTones = primaryPinyin(source, "num")
  const similarity = toneSimilarity(sourceTones, indexed.tones)
  const differentGlyphs = source !== indexed.trigger.text
  const score = Math.round(
    indexed.syllableCount * 20 +
      similarity * 12 +
      indexed.trigger.weight +
      indexed.entity.popularity / 10 +
      (differentGlyphs ? 12 : -24),
  )

  return {
    id: `${chars[0].start}-${chars.at(-1)!.end}-${indexed.entity.id}-${indexed.trigger.id}`,
    start: chars[0].start,
    end: chars.at(-1)!.end,
    surface: source,
    surfacePinyin: sourceTones.join(" "),
    trigger: indexed.trigger,
    triggerPinyin: indexed.tones.join(" "),
    entity: indexed.entity,
    score,
    toneSimilarity: similarity,
    reasons: [
      "无调拼音完全相同",
      `${indexed.syllableCount} 个连续汉字`,
      differentGlyphs ? "字形不同，有反差" : "字形相同，反差较弱",
      `词库权重 ${indexed.trigger.weight}`,
    ],
  }
}

export async function matchText(
  text: string,
  entities: Entity[],
): Promise<MatchResponse> {
  pinyinApi ??= await import("pinyin-pro")
  const safeText = text.slice(0, 2000)
  const { byLengthAndPinyin, lengths } = indexEntities(entities)
  const runs = buildRuns(safeText)
  const hits: MatchHit[] = []
  let windows = 0
  let scannedCharacters = 0

  for (const run of runs) {
    scannedCharacters += run.length
    for (const length of lengths) {
      if (run.length < length) continue
      for (let offset = 0; offset <= run.length - length; offset += 1) {
        windows += 1
        const chars = run.slice(offset, offset + length)
        const source = chars.map((char) => char.value).join("")
        for (const key of pronunciationKeys(source)) {
          const indexedItems = byLengthAndPinyin.get(`${length}:${key}`) ?? []
          for (const indexed of indexedItems) {
            hits.push(buildHit(chars, source, indexed))
          }
        }
      }
    }
  }

  const unique = new Map<string, MatchHit>()
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    if (!unique.has(hit.id)) unique.set(hit.id, hit)
  }

  return {
    text: safeText,
    hits: [...unique.values()].sort(
      (a, b) => a.start - b.start || b.score - a.score,
    ),
    meta: {
      scannedCharacters,
      windows,
      entities: entities.filter((entity) => entity.enabled).length,
    },
  }
}
