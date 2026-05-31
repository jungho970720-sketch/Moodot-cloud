"use client"

import { useEffect, useState } from "react"
import { CalendarView, type CalendarMoodRecord } from "@/components/moodot/calendar-view"
import { TopAppBar } from "@/components/moodot/top-app-bar"
import { BottomNavigation } from "@/components/moodot/bottom-navigation"
import { getCalendarRecords } from "@/lib/calendar-records"

export default function CalendarPage() {
  const [records, setRecords] = useState<CalendarMoodRecord[]>([])

  useEffect(() => {
    getCalendarRecords().then(setRecords).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-mb-bg relative">
      <TopAppBar />
      <main className="relative mx-auto max-w-[375px] px-5 pt-16 pb-32">
        <CalendarView records={records} />
      </main>
      <BottomNavigation />
    </div>
  )
}
