import { serve } from "@hono/node-server"
import { config } from "dotenv"
import { fileURLToPath } from "node:url"

import { createApp } from "./app"
import { JsonFileLexiconRepository } from "./lexicon-repository"

config({ path: [".env.local", ".env"] })

const seedPath = fileURLToPath(
  new URL("../data/lexicon.seed.json", import.meta.url),
)
const localPath = fileURLToPath(
  new URL("../data/lexicon.local.json", import.meta.url),
)

const repository = new JsonFileLexiconRepository(seedPath, localPath)
const app = createApp(repository)
const port = Number(process.env.API_PORT ?? 43128)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Meme API listening on http://127.0.0.1:${info.port}`)
})
