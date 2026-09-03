PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  pack TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  license_status TEXT NOT NULL DEFAULT 'unknown',
  enabled INTEGER NOT NULL DEFAULT 1,
  popularity REAL NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS entities_enabled_popularity
  ON entities (enabled, popularity DESC);
CREATE INDEX IF NOT EXISTS entities_pack ON entities (pack);

CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 10,
  UNIQUE(entity_id, text)
);

CREATE INDEX IF NOT EXISTS triggers_entity_id ON triggers (entity_id);
