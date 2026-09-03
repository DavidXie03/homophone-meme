import type {
  D1Database,
  R2Bucket,
} from "@cloudflare/workers-types"

import { createApp } from "./app"
import { D1LexiconRepository } from "./d1-lexicon-repository"
import { createOcrProvider } from "./ocr-provider"

type Env = {
  DB: D1Database
  ASSETS: R2Bucket
  OCR_PROVIDER?: string
  TENCENTCLOUD_SECRET_ID?: string
  TENCENTCLOUD_SECRET_KEY?: string
  TENCENTCLOUD_REGION?: string
  ADMIN_API_TOKEN?: string
  TURNSTILE_SECRET_KEY?: string
  PUBLIC_WEB_URL?: string
  WEB_ORIGINS?: string
  ADMIN_ORIGINS?: string
}

const worker = {
  fetch(request: Request, env: Env) {
    const repository = new D1LexiconRepository(env.DB)
    const ocrProvider = createOcrProvider(env)
    const app = createApp(repository, ocrProvider, {
      adminToken: env.ADMIN_API_TOKEN,
      publicWebUrl: env.PUBLIC_WEB_URL,
      webOrigins: env.WEB_ORIGINS,
      adminOrigins: env.ADMIN_ORIGINS,
      turnstileSecret: env.TURNSTILE_SECRET_KEY,
    })
    return app.fetch(request, env)
  },
}

export default worker
