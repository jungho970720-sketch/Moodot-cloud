"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Smile, Frown, CloudRain, Leaf, ArrowRight, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export type MoodType = "good" | "bad" | "sad" | "calm"

export interface CalendarMoodRecord {
  id: number
  date: string // YYYY-MM-DD
  memoryAt?: string
  mood: MoodType
  note?: string
}

const moodConfig: Record<MoodType, { color: string; iconColor: string; icon: LucideIcon; label: string }> = {
  good:  { color: "bg-[#FFE8B8]", iconColor: "#374151", icon: Smile,     label: "Good" },
  bad:   { color: "bg-[#F8C8C8]", iconColor: "#374151", icon: Frown,     label: "Bad"  },
  sad:   { color: "bg-[#B0E4F8]", iconColor: "#374151", icon: CloudRain, label: "Sad"  },
  calm:  { color: "bg-[#C0ECD8]", iconColor: "#374151", icon: Leaf,      label: "Calm" },
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"]

interface CalendarViewProps {
  records: CalendarMoodRecord[]
}

export function CalendarView({ records }: CalendarViewProps) {
  const router = useRouter()
  const today = new Date()
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate()

  const getFirstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay()

  const formatDate = (year: number, month: number, day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`

  const getRecordsForDate = (dateStr: string) =>
    records
      .filter((record) => record.date === dateStr)
      .sort((a, b) => {
        if (!a.memoryAt || !b.memoryAt) return b.id - a.id
        return new Date(b.memoryAt).getTime() - new Date(a.memoryAt).getTime()
      })

  const handleDateClick = (dateStr: string) => {
    if (selectedDate !== dateStr) {
      setSelectedDate(dateStr)
      setExpandedDate(null)
      return
    }
    setSelectedDate(null)
    setExpandedDate(null)
  }

  const handleRecordCardClick = () => {
    if (!selectedDate || selectedRecords.length <= 1) return
    setExpandedDate((prev) => (prev === selectedDate ? null : selectedDate))
  }

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentYear((y) => y - 1)
      setCurrentMonth(11)
    } else {
      setCurrentMonth((m) => m - 1)
    }
    setSelectedDate(null)
    setExpandedDate(null)
  }

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentYear((y) => y + 1)
      setCurrentMonth(0)
    } else {
      setCurrentMonth((m) => m + 1)
    }
    setSelectedDate(null)
    setExpandedDate(null)
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth)
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth)
  const selectedRecords = selectedDate ? getRecordsForDate(selectedDate) : []
  const isExpanded = selectedDate !== null && expandedDate === selectedDate
  const visibleSelectedRecords = isExpanded ? selectedRecords : selectedRecords.slice(0, 1)
  const hasCurrentMonthRecords = records.some((record) => {
    const [recordYear, recordMonth] = record.date.split("-")
    return (
      Number(recordYear) === currentYear &&
      Number(recordMonth) === currentMonth + 1
    )
  })

  return (
    <section className="pt-6">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon"
          className="h-9 w-9 rounded-full bg-mb-unselected hover:bg-mb-accent-mint/40"
          onClick={handlePrevMonth}
        >
          <ChevronLeft className="h-4 w-4 text-mb-dark" />
        </Button>
        <h2 className="font-heading font-semibold text-mb-dark text-lg">
          {currentYear}년 {currentMonth + 1}월
        </h2>
        <Button variant="ghost" size="icon"
          className="h-9 w-9 rounded-full bg-mb-unselected hover:bg-mb-accent-mint/40"
          onClick={handleNextMonth}
        >
          <ChevronRight className="h-4 w-4 text-mb-dark" />
        </Button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {DAYS.map((day) => (
          <div key={day} className="text-center text-xs font-semibold text-mb-muted py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm shadow-mb-dark/5 p-3">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = formatDate(currentYear, currentMonth, day)
            const dateRecords = getRecordsForDate(dateStr)
            const latestRecord = dateRecords[0]
            const isToday =
              day === today.getDate() &&
              currentMonth === today.getMonth() &&
              currentYear === today.getFullYear()
            const isSelected = selectedDate === dateStr

            return (
              <button
                key={day}
                onClick={() => handleDateClick(dateStr)}
                className={`
                  relative flex flex-col items-center justify-center
                  h-10 w-full rounded-xl text-xs font-medium transition-all
                  ${isSelected
                    ? "bg-mb-primary text-white shadow-md shadow-mb-primary/30"
                    : isToday
                    ? "ring-2 ring-mb-primary text-mb-primary"
                    : "text-mb-dark hover:bg-mb-unselected"
                  }
                `}
              >
                <span>{day}</span>
                {latestRecord && !isSelected && (
                  <span className="relative mt-0.5">
                    <span className={`block h-4 w-4 rounded-md ${moodConfig[latestRecord.mood].color}`} />
                    {dateRecords.length > 1 && (
                      <span className="absolute -right-1 -top-1 h-3 min-w-3 rounded-full bg-mb-primary px-0.5 text-[8px] leading-3 text-white">
                        {dateRecords.length}
                      </span>
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {!hasCurrentMonthRecords && (
        <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-center text-sm text-mb-muted shadow-sm shadow-mb-dark/5">
          이번 달 기록이 없어요.
        </p>
      )}

      <div className="flex justify-center gap-4 mt-4">
        {Object.entries(moodConfig).map(([key, val]) => {
          const Icon = val.icon
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className={`h-6 w-6 rounded-lg flex items-center justify-center ${val.color}`}>
                <Icon className="h-3.5 w-3.5" style={{ color: val.iconColor }} />
              </span>
              <span className="text-xs text-mb-muted">{val.label}</span>
            </div>
          )
        })}
      </div>

      {selectedDate && (
        <div className="mt-4 bg-white rounded-2xl shadow-sm shadow-mb-dark/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <p className="text-sm font-semibold text-mb-dark mb-2">
            {selectedDate.replace(/-/g, ".")}
          </p>
          {selectedRecords.length > 0 ? (
            <div className="space-y-2">
              {visibleSelectedRecords.map((record, index) => {
                const canExpand = !isExpanded && index === 0 && selectedRecords.length > 1
                const actionLabel = canExpand ? "펼쳐보기" : "상세 보기"
                const handleAction = () => {
                  if (canExpand) { handleRecordCardClick(); return }
                  router.push(`/memory/${record.id}`)
                }
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={handleAction}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-xl text-left transition-colors hover:bg-mb-unselected/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-mb-primary focus-visible:ring-offset-2"
                  >
                    {(() => {
                      const Icon = moodConfig[record.mood].icon
                      return (
                        <span className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${moodConfig[record.mood].color}`}>
                          <Icon className="h-5 w-5" style={{ color: moodConfig[record.mood].iconColor }} />
                        </span>
                      )
                    })()}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-mb-dark">{moodConfig[record.mood].label}</p>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-mb-primary">
                          {actionLabel}
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                      {record.note && <p className="text-xs text-mb-muted mt-1">{record.note}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-mb-muted">이 날의 기록이 없어요.</p>
          )}
        </div>
      )}
    </section>
  )
}
