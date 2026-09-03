import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { config } from "dotenv"

config({ path: ".env.deploy.local", quiet: true, override: true })

const wrangler = resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
)
const databaseName = process.env.D1_DATABASE_NAME || "homophone-meme-db"

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing deploy variable: ${name}`)
  return value
}

function resolveDatabaseId() {
  if (process.env.D1_DATABASE_ID?.trim()) {
    return process.env.D1_DATABASE_ID.trim()
  }
  const result = spawnSync(wrangler, ["d1", "list", "--json"], {
    encoding: "utf8",
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(
      "Unable to query D1; run wrangler login or set D1_DATABASE_ID",
    )
  }
  const databases = JSON.parse(result.stdout)
  const database = databases.find((item) => item.name === databaseName)
  const id = database?.uuid || database?.id
  if (!id) {
    throw new Error(`D1 database not found: ${databaseName}`)
  }
  return id
}

const publicWebUrl = required("PUBLIC_WEB_URL")
const adminPublicUrl = required("ADMIN_PUBLIC_URL")
const configuration = {
  $schema: "../node_modules/wrangler/config-schema.json",
  name: process.env.CF_WORKER_NAME || "homophone-meme-api",
  main: "../apps/api/src/worker.ts",
  compatibility_date: "2026-09-02",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    OCR_PROVIDER: process.env.OCR_PROVIDER || "mock",
    TENCENTCLOUD_REGION:
      process.env.TENCENTCLOUD_REGION || "ap-guangzhou",
    PUBLIC_WEB_URL: publicWebUrl,
    WEB_ORIGINS: process.env.WEB_ORIGINS || publicWebUrl,
    ADMIN_ORIGINS: process.env.ADMIN_ORIGINS || adminPublicUrl,
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: databaseName,
      database_id: resolveDatabaseId(),
      migrations_dir: "../apps/api/migrations",
    },
  ],
  r2_buckets: [
    {
      binding: "ASSETS",
      bucket_name: process.env.R2_BUCKET || "homophone-meme-assets",
    },
  ],
  observability: {
    enabled: true,
  },
}

mkdirSync(".wrangler", { recursive: true })
writeFileSync(
  ".wrangler/wrangler.api.json",
  `${JSON.stringify(configuration, null, 2)}\n`,
)
console.log("Generated .wrangler/wrangler.api.json")
