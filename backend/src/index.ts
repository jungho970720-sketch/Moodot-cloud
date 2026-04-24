import "./config/env.js"

import cors from "cors"
import express, { type ErrorRequestHandler } from "express"

import { getAllowedOrigins, getPort } from "./config/env.js"
import { HttpError } from "./lib/supabase.js"
import { collectionsRouter } from "./routes/collections.js"
import { interventionsRouter } from "./routes/interventions.js"
import { memoriesRouter } from "./routes/memories.js"

const app = express()
const allowedOrigins = getAllowedOrigins()

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS.`))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: "1mb" }))

app.get("/health", (_request, response) => {
  response.json({ ok: true })
})

app.use("/api/memories", memoriesRouter)
app.use("/api/collections", collectionsRouter)
app.use("/api/interventions", interventionsRouter)

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = error instanceof HttpError ? error.status : 500
  const message =
    error instanceof Error && error.message
      ? error.message
      : "요청 처리 중 오류가 발생했습니다."

  if (status >= 500) {
    console.error(error)
  }

  response.status(status).json({ error: message })
}

app.use(errorHandler)

const port = getPort()

app.listen(port, "0.0.0.0", () => {
  console.log(`Moodot backend listening on http://0.0.0.0:${port}`)
})
