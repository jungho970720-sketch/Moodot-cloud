import "server-only"

import { decryptMemoryText, type MemoryTextRecord } from "@/lib/server/memory-text-crypto"

export const MEMORY_SELECT_COLUMNS =
  "id,title,text,text_ciphertext,text_iv,text_key_version,image_url,emotion_id,with_whom,memory_at,place_name,location_label,location_lat,location_lng,processed"

export type MemoryDbRow = MemoryTextRecord & {
  id: number
  title: string | null
  image_url: string | null
  emotion_id: number | null
  with_whom: string | null
  memory_at: string | null
  place_name: string | null
  location_label: string | null
  location_lat: number | null
  location_lng: number | null
  processed: boolean | null
}

export type MemoryTextDbRow = MemoryTextRecord & {
  id: number
}

export function toPublicMemoryRow(row: MemoryDbRow) {
  return {
    id: row.id,
    title: row.title,
    text: decryptMemoryText(row),
    image_url: row.image_url,
    emotion_id: row.emotion_id,
    with_whom: row.with_whom,
    memory_at: row.memory_at,
    place_name: row.place_name,
    location_label: row.location_label,
    location_lat: row.location_lat,
    location_lng: row.location_lng,
    processed: row.processed ?? null,
  }
}

export function buildMemoryTextMap(rows: MemoryTextDbRow[]): Record<number, string | null> {
  const textMap: Record<number, string | null> = {}

  rows.forEach((row) => {
    textMap[row.id] = decryptMemoryText(row)
  })

  return textMap
}
