import { config } from "dotenv"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

config({ path: resolve(backendDir, "../.env.local") })
config({ path: resolve(backendDir, ".env"), override: true })

export function requireEnv(name: string) {
  const value = process.env[name]
  if (!value || value.trim() === "") {
    throw new Error(`${name} is missing.`)
  }
  return value
}

export function getPort() {
  return Number.parseInt(process.env.PORT ?? "4000", 10)
}

export function getAllowedOrigins() {
  const rawValue = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000"
  return rawValue
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
}
