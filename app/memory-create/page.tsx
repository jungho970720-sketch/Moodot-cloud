"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { compressImage } from "@/lib/image-compression"
import { uploadImage } from "@/lib/storage/image"
import { createMemory } from "@/lib/services/memory"
import logger from "@/lib/logger"
import { validateMemoryMutationInput } from "@/lib/memory-validation"
import { BottomNavigation } from "@/components/moodot/bottom-navigation"
import { EMOTION_ID_MAP, MemoryForm, type MoodType, type UploadStatus, type WithType } from "@/components/moodot/memory-form"
import { reverseGeocode } from "@/lib/location/reverse-geocode"

function getBrowserCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof window === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60_000 },
    )
  })
}

function toMemoryAtIso(memoryAt: string): string | null {
  const date = memoryAt ? new Date(memoryAt) : new Date()
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export default function CreatePage() {
  const router = useRouter()
  const [mood,            setMood]            = useState<MoodType>("good")
  const [withWho,         setWithWho]         = useState<WithType>("solo")
  const [memoryAt,        setMemoryAt]        = useState<string>("")
  const [title,           setTitle]           = useState<string>("")
  const [text,            setText]            = useState<string>("")
  const [imageUrl,        setImageUrl]        = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadStatus,    setUploadStatus]    = useState<UploadStatus>("idle")
  const [locationLabel,   setLocationLabel]   = useState<string>("")
  const [locationLat,     setLocationLat]     = useState<number | null>(null)
  const [locationLng,     setLocationLng]     = useState<number | null>(null)
  const [placeName,       setPlaceName]       = useState<string>("")
  const [isSaving,        setIsSaving]        = useState<boolean>(false)
  const [geoLoading,      setGeoLoading]      = useState<boolean>(false)

  // ── 이미지 Blob URL 정리 ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  // ── 현재 시각 자동 세팅 (마운트 1회) ─────────────────────────────────────
  useEffect(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    setMemoryAt(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
    )
  }, [])

  // ── 현재 위치 자동 세팅 (마운트 1회, 실패·거부 시 빈값 유지) ─────────────
  useEffect(() => {
    setGeoLoading(true)
    getBrowserCurrentPosition()
      .then(async (pos) => {
        if (!pos) return
        const label = await reverseGeocode(pos.lat, pos.lng)
        setLocationLat(pos.lat)
        setLocationLng(pos.lng)
        setLocationLabel(label)
      })
      .catch(() => { /* 권한 거부 등 — 빈값 유지 */ })
      .finally(() => setGeoLoading(false))
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePhotoUpload = async (file: File) => {
    setUploadStatus("uploading")
    try {
      const uploadFile = await compressImage(file)
      const path = await uploadImage(uploadFile)
      setImageUrl(path)
      setUploadStatus("success")
    } catch (error) {
      logger.error("[memory-create] photo upload error:", error)
      setUploadStatus("failed")
      const message = error instanceof Error ? error.message : "사진 업로드에 실패했습니다."
      alert(`사진 업로드 실패: ${message}`)
    }
  }

  const handlePhotoSelected = (file: File) => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImagePreviewUrl(URL.createObjectURL(file))
    void handlePhotoUpload(file)
  }

  const handleLocationSelect = async (lat: number, lng: number) => {
    const label = await reverseGeocode(lat, lng)
    setLocationLat(lat)
    setLocationLng(lng)
    setLocationLabel(label)
  }

  const handleClearLocation = () => {
    setLocationLat(null)
    setLocationLng(null)
    setLocationLabel("")
  }

  // 감정만 필수 — 나머지는 선택
  const handleSaveMemory = async () => {
    if (!mood) {
      alert("감정을 선택해 주세요.")
      return
    }
    if (uploadStatus === "uploading") {
      alert("사진 업로드가 완료된 후 저장해 주세요.")
      return
    }
    if (uploadStatus === "failed") {
      alert("사진 업로드에 실패했습니다. 다시 업로드한 뒤 저장해 주세요.")
      return
    }

    const memoryAtIso = toMemoryAtIso(memoryAt)
    if (!memoryAtIso) {
      alert("날짜 형식이 올바르지 않습니다.")
      return
    }

    const input = {
      title:          title.trim() === "" ? null : title.trim(),
      text:           text.trim() === "" ? null : text.trim(),
      image_url:      imageUrl,
      emotion_id:     EMOTION_ID_MAP[mood],
      with_whom:      withWho === "solo" ? "Solo" : "Together",
      location_lat:   locationLat,
      location_lng:   locationLng,
      location_label: locationLabel.trim() === "" ? null : locationLabel.trim(),
      place_name:     placeName.trim() === "" ? null : placeName.trim(),
      memory_at:      memoryAtIso,
    }
    const validation = validateMemoryMutationInput(input)
    if (!validation.ok) {
      alert(validation.error)
      return
    }

    setIsSaving(true)
    try {
      const newId = await createMemory(validation.value)
      router.replace(`/memory/${newId}`)
    } catch (error) {
      logger.error("[memory-create] save error:", error)
      const message = error instanceof Error ? error.message : "저장 중 오류가 발생했습니다."
      alert(`저장 실패: ${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-mb-bg text-mb-dark">
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-mb-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[375px] items-center justify-between px-5">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-mb-dark/80 transition-opacity duration-200 hover:opacity-70"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
          <h1 className="font-heading text-lg font-bold tracking-tight text-mb-dark">New Memory</h1>
          <div className="w-5" />
        </div>
      </header>

      <main className="mx-auto flex max-w-[375px] flex-col gap-3 px-5 pb-32 pt-20">
        <MemoryForm
          mode="create"
          mood={mood}
          onMoodChange={setMood}
          withWho={withWho}
          onWithWhoChange={setWithWho}
          memoryAt={memoryAt}
          onMemoryAtChange={setMemoryAt}
          title={title}
          onTitleChange={setTitle}
          text={text}
          onTextChange={setText}
          imageUrl={imageUrl}
          imagePreviewUrl={imagePreviewUrl}
          uploadStatus={uploadStatus}
          onPhotoSelected={handlePhotoSelected}
          locationLabel={locationLabel}
          locationLat={locationLat}
          locationLng={locationLng}
          placeName={placeName}
          onPlaceNameChange={setPlaceName}
          geoLoading={geoLoading}
          onLocationSelect={handleLocationSelect}
          onClearLocation={handleClearLocation}
          isSaving={isSaving}
          onSave={handleSaveMemory}
        />
      </main>

      <BottomNavigation />
    </div>
  )
}
