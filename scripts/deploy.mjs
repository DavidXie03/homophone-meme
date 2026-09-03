import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

import { config } from "dotenv"

config({ path: ".env.deploy.local", quiet: true, override: true })

const target = process.argv[2] || "all"
if (!["all", "api", "web", "admin"].includes(target)) {
  throw new Error("部署目标只能是 all、api、web 或 admin")
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const wrangler = resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
)
const generatedConfig = ".wrangler/wrangler.api.json"
const environment = {
  ...process.env,
  NEXT_PUBLIC_API_BASE_URL: "/api",
  VITE_API_BASE_URL: "/api",
  VITE_PUBLIC_WEB_URL: process.env.PUBLIC_WEB_URL || "",
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    input,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} 执行失败`)
  }
}

function required(name) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`缺少部署变量 ${name}`)
  return value
}

function putWorkerSecret(name) {
  const value = environment[name]?.trim()
  if (!value) return
  run(
    wrangler,
    ["secret", "put", name, "--config", generatedConfig],
    `${value}\n`,
  )
}

function configurePages(projectName) {
  const apiOrigin = required("API_ORIGIN")
  run(
    wrangler,
    ["pages", "secret", "put", "API_ORIGIN", "--project-name", projectName],
    `${apiOrigin}\n`,
  )
}

run(npm, ["run", "verify"])

if (target === "all" || target === "api") {
  run(npm, ["run", "cloudflare:config"])
  run(wrangler, [
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    generatedConfig,
  ])
  run(wrangler, ["deploy", "--config", generatedConfig])
  for (const name of [
    "ADMIN_API_TOKEN",
    "TENCENTCLOUD_SECRET_ID",
    "TENCENTCLOUD_SECRET_KEY",
    "TURNSTILE_SECRET_KEY",
  ]) {
    putWorkerSecret(name)
  }
}

if (target === "all" || target === "web") {
  const project = environment.CF_WEB_PROJECT || "homophone-meme"
  run(npm, ["run", "build:production"])
  configurePages(project)
  run(wrangler, [
    "pages",
    "deploy",
    "out",
    "--project-name",
    project,
    "--branch",
    "main",
  ])
}

if (target === "all" || target === "admin") {
  const project = environment.CF_ADMIN_PROJECT || "homophone-meme-admin"
  run(npm, ["run", "build:admin:production"])
  configurePages(project)
  run(wrangler, [
    "pages",
    "deploy",
    "dist/admin",
    "--project-name",
    project,
    "--branch",
    "main",
  ])
}
