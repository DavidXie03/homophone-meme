import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types"

import seed from "../data/lexicon.seed.json"
import type { Entity, Trigger } from "../../../packages/core/src/index"
import {
  mergeSyncedTriggers,
  type LexiconRepository,
} from "./lexicon-repository"

type EntityRow = {
  id: string
  display_name: string
  pack: string
  category: string
  description: string
  image_url: string
  source: string
  license_status: Entity["licenseStatus"]
  enabled: number
  popularity: number
  created_at: string
  updated_at: string
}

type TriggerRow = {
  id: string
  entity_id: string
  text: string
  kind: Trigger["kind"]
  weight: number
}

export class D1LexiconRepository implements LexiconRepository {
  constructor(private readonly db: D1Database) {}

  private statementsFor(entity: Entity) {
    return [
      this.db
        .prepare(
          `INSERT INTO entities (
            id, display_name, pack, category, description, image_url, source,
            license_status, enabled, popularity, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            pack = excluded.pack,
            category = excluded.category,
            description = excluded.description,
            image_url = excluded.image_url,
            source = excluded.source,
            license_status = excluded.license_status,
            enabled = excluded.enabled,
            popularity = excluded.popularity,
            updated_at = excluded.updated_at`,
        )
        .bind(
          entity.id,
          entity.displayName,
          entity.pack,
          entity.category,
          entity.description,
          entity.imageUrl,
          entity.source,
          entity.licenseStatus,
          entity.enabled ? 1 : 0,
          entity.popularity,
          entity.createdAt,
          entity.updatedAt,
        ),
      this.db.prepare("DELETE FROM triggers WHERE entity_id = ?").bind(entity.id),
      ...entity.triggers.map((trigger) =>
        this.db
          .prepare(
            `INSERT INTO triggers (id, entity_id, text, kind, weight)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            trigger.id,
            entity.id,
            trigger.text,
            trigger.kind,
            trigger.weight,
          ),
      ),
    ]
  }

  private async runBatches(statements: D1PreparedStatement[]) {
    for (let offset = 0; offset < statements.length; offset += 50) {
      await this.db.batch(statements.slice(offset, offset + 50))
    }
  }

  async list() {
    const [entityResult, triggerResult] = await Promise.all([
      this.db.prepare("SELECT * FROM entities ORDER BY popularity DESC").all<EntityRow>(),
      this.db.prepare("SELECT * FROM triggers ORDER BY weight DESC").all<TriggerRow>(),
    ])
    const triggersByEntity = new Map<string, Trigger[]>()
    for (const row of triggerResult.results) {
      const current = triggersByEntity.get(row.entity_id) ?? []
      current.push({
        id: row.id,
        text: row.text,
        kind: row.kind,
        weight: row.weight,
      })
      triggersByEntity.set(row.entity_id, current)
    }
    return entityResult.results.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      pack: row.pack,
      category: row.category,
      description: row.description,
      imageUrl: row.image_url,
      source: row.source,
      licenseStatus: row.license_status,
      enabled: Boolean(row.enabled),
      popularity: row.popularity,
      triggers: triggersByEntity.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async create(entity: Entity) {
    const existing = await this.db
      .prepare("SELECT id FROM entities WHERE id = ?")
      .bind(entity.id)
      .first()
    if (existing) throw new Error("ENTITY_EXISTS")
    await this.runBatches(this.statementsFor(entity))
    return entity
  }

  async upsertMany(incoming: Entity[]) {
    const current = await this.list()
    let created = 0
    let updated = 0
    const merged = incoming.map((item) => {
      const existing = current.find(
        (entity) =>
          entity.id === item.id ||
          (entity.displayName === item.displayName && entity.pack === item.pack),
      )
      if (!existing) {
        created += 1
        return item
      }
      updated += 1
      return {
        ...existing,
        ...item,
        id: existing.id,
        enabled: existing.enabled,
        triggers: mergeSyncedTriggers(existing, item),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }
    })
    await this.runBatches(merged.flatMap((item) => this.statementsFor(item)))
    return { created, updated }
  }

  async update(id: string, patch: Partial<Entity>) {
    const current = (await this.list()).find((entity) => entity.id === id)
    if (!current) return null
    const entity = {
      ...current,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    await this.runBatches(this.statementsFor(entity))
    return entity
  }

  async remove(id: string) {
    const result = await this.db
      .prepare("DELETE FROM entities WHERE id = ?")
      .bind(id)
      .run()
    return result.meta.changes > 0
  }

  async reset() {
    await this.db.batch([
      this.db.prepare("DELETE FROM triggers"),
      this.db.prepare("DELETE FROM entities"),
    ])
    const entities = structuredClone(seed) as Entity[]
    await this.runBatches(entities.flatMap((entity) => this.statementsFor(entity)))
    return entities
  }
}
