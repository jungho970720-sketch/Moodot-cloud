import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import type { MemoryRow } from "@/lib/services/memory"
import { MemoriesListView } from "@/components/moodot/memories-list-view"

const { pushMock, getMemoriesMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getMemoriesMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock("@/lib/services/memory", () => ({
  getMemories: getMemoriesMock,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 1,
    title: "기본 제목",
    text: "기본 본문",
    image_url: null,
    emotion_id: 1,
    with_whom: "Solo",
    memory_at: "2026-04-21T10:30:00.000Z",
    place_name: null,
    location_label: null,
    location_lat: null,
    location_lng: null,
    ...overrides,
  }
}

describe("MemoriesListView", () => {
  beforeEach(() => {
    pushMock.mockReset()
    getMemoriesMock.mockReset()
  })

  it("초기 로딩 후 메모 목록을 응답 순서대로 렌더링한다", async () => {
    const deferred = createDeferred<MemoryRow[]>()
    getMemoriesMock.mockReturnValueOnce(deferred.promise)

    render(<MemoriesListView />)

    expect(screen.getByText("메모리를 불러오는 중...")).toBeInTheDocument()

    deferred.resolve([
      makeMemory({ id: 11, title: "첫 번째 기록" }),
      makeMemory({ id: 22, title: "두 번째 기록" }),
    ])

    const firstCardTitle = await screen.findByRole("heading", { name: "첫 번째 기록" })
    expect(firstCardTitle).toBeInTheDocument()

    const headings = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)
    expect(headings).toEqual(["첫 번째 기록", "두 번째 기록"])
    expect(getMemoriesMock).toHaveBeenCalledWith(10, 0)
  })

  it("더 보기 버튼은 다음 페이지를 append 하고 offset을 증가시킨다", async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) =>
      makeMemory({
        id: index + 1,
        title: `기록 ${index + 1}`,
      }),
    )

    getMemoriesMock
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        makeMemory({ id: 11, title: "기록 11" }),
      ])

    const user = userEvent.setup()
    render(<MemoriesListView />)

    await screen.findByRole("heading", { name: "기록 10" })

    const loadMoreButton = screen.getByRole("button", { name: "Load more" })
    await user.click(loadMoreButton)

    await screen.findByRole("heading", { name: "기록 11" })

    expect(getMemoriesMock).toHaveBeenNthCalledWith(1, 10, 0)
    expect(getMemoriesMock).toHaveBeenNthCalledWith(2, 10, 10)
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument()
  })

  it("검색은 title 과 text 기준으로만 동작한다", async () => {
    getMemoriesMock.mockResolvedValueOnce([
      makeMemory({ id: 1, title: "서울 산책", text: "한강이 좋았다", place_name: "부산" }),
      makeMemory({ id: 2, title: "저녁 기록", text: "needle keyword", location_label: "제주" }),
    ])

    render(<MemoriesListView />)

    await screen.findByRole("heading", { name: "서울 산책" })

    const searchInput = screen.getByPlaceholderText("Search your memories...")

    fireEvent.change(searchInput, { target: { value: "부산" } })
    expect(screen.getByText("표시할 메모리가 없습니다.")).toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: "" } })
    fireEvent.change(searchInput, { target: { value: "needle" } })

    expect(screen.getByRole("heading", { name: "저녁 기록" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "서울 산책" })).not.toBeInTheDocument()
  })

  it("fallback 표시값을 현재 계약대로 보여준다", async () => {
    getMemoriesMock.mockResolvedValueOnce([
      makeMemory({
        id: 1,
        title: null,
        memory_at: null,
        text: null,
      }),
    ])

    render(<MemoriesListView />)

    const title = await screen.findByRole("heading", { name: "Untitled Memory" })
    const article = title.closest("article")

    expect(article).not.toBeNull()
    expect(within(article!).getByText("날짜 정보 없음")).toBeInTheDocument()
    expect(within(article!).queryByText("내용 없음")).not.toBeInTheDocument()

    const bodyParagraph = article!.querySelector("p.font-body") as HTMLParagraphElement | null
    expect(bodyParagraph?.textContent).toBe(" ")
  })
})
