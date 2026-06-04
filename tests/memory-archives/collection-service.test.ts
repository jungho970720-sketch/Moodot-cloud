import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createCollection,
  getAvailableMemories,
  getCollections,
} from "@/lib/services/collection"

const { getAccessTokenMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getAccessToken: getAccessTokenMock,
}))

describe("collection service", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    getAccessTokenMock.mockReset()
    getAccessTokenMock.mockResolvedValue(null)
    vi.stubGlobal("fetch", fetchMock)
  })

  it("getCollections 는 컬렉션 목록 URL을 호출한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getCollections()

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("getAvailableMemories 는 현재 컬렉션 ID를 query 로 전달한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getAvailableMemories("collection 1")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/available-memories?currentCollectionId=collection%201",
      expect.anything(),
    )
  })

  it("access token 이 있으면 Authorization 헤더를 포함한다", async () => {
    getAccessTokenMock.mockResolvedValue("user-b-token")
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getCollections()

    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get("Authorization")).toBe("Bearer user-b-token")
  })

  it("createCollection 은 JSON body 와 인증 헤더를 함께 보낸다", async () => {
    getAccessTokenMock.mockResolvedValue("user-c-token")
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "collection-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await createCollection({
      title: "여행",
      note: null,
      location: null,
      start_date: null,
      end_date: null,
      cover_memory_id: null,
      memory_ids: [1, 2],
    })

    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(init?.method).toBe("POST")
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("Authorization")).toBe("Bearer user-c-token")
    expect(init?.body).toBe(
      JSON.stringify({
        title: "여행",
        note: null,
        location: null,
        start_date: null,
        end_date: null,
        cover_memory_id: null,
        memory_ids: [1, 2],
      }),
    )
  })
})
