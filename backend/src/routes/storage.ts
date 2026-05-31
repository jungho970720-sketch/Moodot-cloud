import { randomUUID } from "node:crypto"
import { extname } from "node:path"

import { Router } from "express"

import {
  createS3SignedUrl,
  uploadObjectToS3,
} from "../lib/s3-storage.js"
import { HttpError, getAuthenticatedUser } from "../lib/auth.js"

const S3_PATH_PREFIX = "s3/"
const S3_PATH_FALLBACK_PREFIX = "s3/"

type UploadImageInput = {
  fileName?: unknown
  fileType?: unknown
  fileData?: unknown
}

function getFileExtension(fileName: string, fileType: string | null) {
  const nameExt = extname(fileName).replace(".", "").toLowerCase()
  if (nameExt) return nameExt

  const mimeExt = fileType?.split("/")[1]?.split("+")[0]?.toLowerCase() ?? ""
  return mimeExt || "jpg"
}

function parseBase64Payload(rawValue: unknown) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new HttpError("업로드할 이미지 데이터가 필요합니다.", 400)
  }

  try {
    return Buffer.from(rawValue, "base64")
  } catch {
    throw new HttpError("이미지 데이터를 해석할 수 없습니다.", 400)
  }
}

function toS3StoragePath(key: string) {
  return `${S3_PATH_PREFIX}${key}`
}

function getS3ObjectKey(path: string) {
  return path.startsWith(S3_PATH_FALLBACK_PREFIX) ? path.slice(S3_PATH_FALLBACK_PREFIX.length) : null
}

export const storageRouter = Router()

storageRouter.post("/images", async (request, response, next) => {
  try {
    const input = request.body as UploadImageInput
    const fileName =
      typeof input.fileName === "string" && input.fileName.trim() !== ""
        ? input.fileName.trim()
        : "upload.jpg"
    const fileType =
      typeof input.fileType === "string" && input.fileType.trim() !== ""
        ? input.fileType.trim()
        : null
    const fileBuffer = parseBase64Payload(input.fileData)

    const user = await getAuthenticatedUser(request)
    const ext = getFileExtension(fileName, fileType)
    const path = `${user.id}/${Date.now()}-${randomUUID()}.${ext}`

    await uploadObjectToS3({
      key: path,
      body: fileBuffer,
      contentType: fileType,
    })

    response.status(201).json({ path: toS3StoragePath(path) })
  } catch (error) {
    next(error)
  }
})

storageRouter.get("/images/signed-url", async (request, response, next) => {
  try {
    const path =
      typeof request.query.path === "string" && request.query.path.trim() !== ""
        ? request.query.path.trim()
        : null

    if (!path) {
      response.status(400).json({ error: "이미지 경로가 필요합니다." })
      return
    }

    const s3Key = getS3ObjectKey(path)
    if (!s3Key) {
      response.status(400).json({ error: "유효하지 않은 이미지 경로입니다." })
      return
    }

    const url = await createS3SignedUrl(s3Key)
    response.json({ url })
  } catch (error) {
    next(error)
  }
})
