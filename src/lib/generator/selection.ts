import type { MatchHit } from "@meme/core"

export const MINIMUM_AUTO_SCORE = 70

export function selectAutomaticHits(hits: MatchHit[]) {
  const picked: MatchHit[] = []
  const pickedSurfaces = new Set<string>()
  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    if (hit.score < MINIMUM_AUTO_SCORE) continue
    if (pickedSurfaces.has(hit.surface)) continue
    if (picked.some((item) => hit.start < item.end && item.start < hit.end)) {
      continue
    }
    picked.push(hit)
    pickedSurfaces.add(hit.surface)
  }
  return picked
}
