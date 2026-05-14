import { Pool } from "pg"

let pool: Pool | null = null

export function hasPostgresConfig() {
  return Boolean(getDatabaseUrl() || getDatabaseHost())
}

export function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? process.env.RDS_DATABASE_URL ?? process.env.POSTGRES_URL
}

function getDatabaseHost() {
  return process.env.DB_HOST ?? process.env.PGHOST
}

export function getPostgresPool() {
  if (pool) return pool

  const connectionString = getDatabaseUrl()
  const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }

  pool = connectionString
    ? new Pool({ connectionString, ssl })
    : new Pool({
        host: getDatabaseHost(),
        port: Number.parseInt(process.env.DB_PORT ?? process.env.PGPORT ?? "5432", 10),
        database: process.env.DB_NAME ?? process.env.PGDATABASE ?? "postgres",
        user: process.env.DB_USER ?? process.env.PGUSER ?? "postgres",
        password: process.env.DB_PASSWORD ?? process.env.PGPASSWORD,
        ssl,
      })

  return pool
}
