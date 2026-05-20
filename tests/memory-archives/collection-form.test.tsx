import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { CollectionForm, getMemoryLocalDateKey } from "@/components/moodot/collection-form"
import type { MemoryRow } from "@/lib/services/memory"

vi.mock("@/components/moodot/signed-image", () => ({
  SignedImage: ({ alt, path }: { alt: string; path: string }) => (
    <div data-testid="signed-image">{`${alt}:${path}`}</div>
  ),
}))

function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 1,
    title: "테스트 기록",
    text: "컬렉션에 넣을 기록",
    image_url: null,
    emotion_id: 1,
    with_whom: "Solo",
    memory_at: "2026-05-19T06:30:00.000Z",
    place_name: null,
    location_label: null,
    location_lat: null,
    location_lng: null,
    processed: null,
    ...overrides,
  }
}

describe("CollectionForm", () => {
  it("날짜 필터가 기록을 숨기면 기간 초기화로 다시 볼 수 있다", async () => {
    const user = userEvent.setup()

    render(
      <CollectionForm
        initialValues={{
          title: "새 컬렉션",
          start_date: "2026-05-20",
          end_date: "2026-05-20",
        }}
        availableMemories={[makeMemory()]}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText("해당 기간에 해당하는 기록이 없습니다.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "기간 초기화" }))

    expect(screen.getByText("테스트 기록")).toBeInTheDocument()
  })

  it("기록 날짜 비교용 키를 브라우저 로컬 날짜로 만든다", () => {
    expect(getMemoryLocalDateKey("2026-05-19T06:30:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(getMemoryLocalDateKey("2026-05-19")).toBe("2026-05-19")
    expect(getMemoryLocalDateKey(null)).toBeNull()
  })
})
