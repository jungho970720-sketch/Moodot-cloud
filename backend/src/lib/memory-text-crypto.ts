import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const CURRENT_TEXT_KEY_VERSION = 1
const KEY_ENV_NAME = "MEMORY_TEXT_ENCRYPTION_KEY"

let cachedKey: Buffer | null = null

export type MemoryTextRecord = {
  text: string | null
  text_ciphertext: string | null
  text_iv: string | null
  text_key_version: number | null
}

export type EncryptedMemoryTextPayload = {
  text_ciphertext: string | null
  text_iv: string | null
  text_key_version: number
}

function decodeEncryptionKey(rawValue: string): Buffer {
  const trimmed = rawValue.trim()

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex")
  }

  const base64Buffer = Buffer.from(trimmed, "base64")
  if (base64Buffer.length === 32) {
    return base64Buffer
  }

  const utf8Buffer = Buffer.from(trimmed, "utf8")
  if (utf8Buffer.length === 32) {
    return utf8Buffer
  }

  throw new Error(
    `${KEY_ENV_NAME} must be a 32-byte key, a 64-character hex string, or base64 that decodes to 32 bytes.`,
  )
}

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey

  const rawValue = process.env[KEY_ENV_NAME]
  if (!rawValue) {
    throw new Error(`${KEY_ENV_NAME} is missing.`)
  }

  cachedKey = decodeEncryptionKey(rawValue)
  return cachedKey
}

export function encryptMemoryText(text: string | null): EncryptedMemoryTextPayload {
  if (text == null || text === "") {
    return {
      text_ciphertext: null,
      text_iv: null,
      text_key_version: CURRENT_TEXT_KEY_VERSION,
    }
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  const payload = Buffer.concat([encrypted, authTag]).toString("base64")

  return {
    text_ciphertext: payload,
    text_iv: iv.toString("base64"),
    text_key_version: CURRENT_TEXT_KEY_VERSION,
  }
}

export function decryptMemoryText(record: MemoryTextRecord): string | null {
  if (!record.text_ciphertext) {
    return record.text ?? null
  }

  if (!record.text_iv) {
    throw new Error("Encrypted memory text is missing its IV.")
  }

  const keyVersion = record.text_key_version ?? CURRENT_TEXT_KEY_VERSION
  if (keyVersion !== CURRENT_TEXT_KEY_VERSION) {
    throw new Error(`Unsupported memory text key version: ${keyVersion}`)
  }

  const payload = Buffer.from(record.text_ciphertext, "base64")
  if (payload.length <= AUTH_TAG_LENGTH) {
    throw new Error("Encrypted memory text payload is invalid.")
  }

  const ciphertext = payload.subarray(0, payload.length - AUTH_TAG_LENGTH)
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH)
  const iv = Buffer.from(record.text_iv, "base64")

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString("utf8")
}
