import { getMemories } from "@/lib/services/memory"
import type { CalendarMoodRecord, MoodType } from "@/components/moodot/calendar-view"

const emotionIdMap: Record<number, MoodType> = {
  1: "good",
  2: "bad",
  3: "sad",
  4: "calm",
}

function normalizeDate(dateValue: string | null) {
  if (!dateValue) return null

  const date = new Date(dateValue)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export async function getCalendarRecords(): Promise<CalendarMoodRecord[]> {
  const memories = await getMemories().catch(() => [])

  return memories.reduce<CalendarMoodRecord[]>((records, memory) => {
    const date = normalizeDate(memory.memory_at)
    const mood = memory.emotion_id ? emotionIdMap[memory.emotion_id] : null

    if (!date || !mood) {
      return records
    }

    records.push({
      id: memory.id,
      date,
      memoryAt: memory.memory_at ?? undefined,
      mood,
      note: memory.text ?? memory.title ?? undefined,
    })

    return records
  }, [])
}
