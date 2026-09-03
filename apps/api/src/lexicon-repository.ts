import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { Entity, Trigger } from "../../../packages/core/src/index"

export function mergeSyncedTriggers(
  existing: Entity,
  incoming: Entity,
): Trigger[] {
  const manual = existing.triggers.filter((trigger) => trigger.kind === "manual")
  const manualTexts = new Set(manual.map((trigger) => trigger.text))
  const generated = incoming.triggers
    .filter((trigger) => !manualTexts.has(trigger.text))
    .map((trigger, index) => ({
      ...trigger,
      id: `${existing.id}-synced-${index + 1}`,
    }))
  return [...manual, ...generated]
}

export interface LexiconRepository {
  list(): Promise<Entity[]>
  create(entity: Entity): Promise<Entity>
  upsertMany(entities: Entity[]): Promise<{ created: number; updated: number }>
  update(id: string, patch: Partial<Entity>): Promise<Entity | null>
  remove(id: string): Promise<boolean>
  reset(): Promise<Entity[]>
}

export class JsonFileLexiconRepository implements LexiconRepository {
  private cache: Entity[] | null = null

  constructor(
    private readonly seedPath: string,
    private readonly localPath: string,
  ) {}

  private async loadSeed() {
    return JSON.parse(await readFile(this.seedPath, "utf8")) as Entity[]
  }

  private async persist(entities: Entity[]) {
    await mkdir(dirname(this.localPath), { recursive: true })
    await writeFile(this.localPath, `${JSON.stringify(entities, null, 2)}\n`)
    this.cache = entities
  }

  async list() {
    if (this.cache) return structuredClone(this.cache)
    try {
      this.cache = JSON.parse(
        await readFile(this.localPath, "utf8"),
      ) as Entity[]
    } catch {
      this.cache = await this.loadSeed()
    }
    return structuredClone(this.cache)
  }

  async create(entity: Entity) {
    const entities = await this.list()
    if (entities.some((item) => item.id === entity.id)) {
      throw new Error("ENTITY_EXISTS")
    }
    entities.push(entity)
    await this.persist(entities)
    return structuredClone(entity)
  }

  async upsertMany(incoming: Entity[]) {
    const entities = await this.list()
    let created = 0
    let updated = 0

    for (const item of incoming) {
      const index = entities.findIndex(
        (entity) =>
          entity.id === item.id ||
          (entity.displayName === item.displayName && entity.pack === item.pack),
      )
      if (index < 0) {
        entities.push(item)
        created += 1
        continue
      }

      const existing = entities[index]
      entities[index] = {
        ...existing,
        ...item,
        id: existing.id,
        enabled: existing.enabled,
        triggers: mergeSyncedTriggers(existing, item),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }
      updated += 1
    }

    await this.persist(entities)
    return { created, updated }
  }

  async update(id: string, patch: Partial<Entity>) {
    const entities = await this.list()
    const index = entities.findIndex((item) => item.id === id)
    if (index < 0) return null
    entities[index] = {
      ...entities[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    await this.persist(entities)
    return structuredClone(entities[index])
  }

  async remove(id: string) {
    const entities = await this.list()
    const next = entities.filter((item) => item.id !== id)
    if (next.length === entities.length) return false
    await this.persist(next)
    return true
  }

  async reset() {
    const seed = await this.loadSeed()
    await this.persist(seed)
    return structuredClone(seed)
  }
}
