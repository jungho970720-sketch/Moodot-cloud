import { beforeEach, describe, expect, it, vi } from "vitest"

import { getMemories, getMemoryById } from "@/lib/services/memory"

const { getAccessTokenMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getAccessToken: getAccessTokenMock,
}))

describe("memory service", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    getAccessTokenMock.mockReset()
    getAccessTokenMock.mockResolvedValue(null)
    vi.stubGlobal("fetch", fetchMock)
  })

  it("getMemories 는 limit 와 offset query 를 포함한 URL로 호출한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getMemories(10, 20)

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memories?limit=10&offset=20",
      expect.anything(),
    )
  })

  it("getMemories 는 limit 가 없으면 기본 목록 URL을 호출한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getMemories()

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memories",
      expect.anything(),
    )
  })

  it("getMemoryById 는 단건 API URL을 호출한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 7 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getMemoryById(7)

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memories/7",
      expect.anything(),
    )
  })

  it("access token 이 있으면 Authorization 헤더를 포함한다", async () => {
    getAccessTokenMock.mockResolvedValue("user-a-token")
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getMemories()

    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get("Authorization")).toBe("Bearer user-a-token")
  })

  it("API 가 에러 응답을 주면 에러 메시지를 그대로 던진다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "메모리 조회 실패: 인증이 필요합니다." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(getMemoryById(3)).rejects.toThrow("메모리 조회 실패: 인증이 필요합니다.")
  })
})
