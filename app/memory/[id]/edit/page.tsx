"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { X } from "lucide-react"
import { compressImage } from "@/lib/image-compression"
import { uploadImage, getSignedUrl } from "@/lib/storage/image"
import { getMemoryById, updateMemory, deleteMemory } from "@/lib/services/memory"
import logger from "@/lib/logger"
import { validateMemoryMutationInput } from "@/lib/memory-validation"
import { BottomNavigation } from "@/components/moodot/bottom-navigation"
import {
  EMOTION_ID_MAP,
  EMOTION_ID_REVERSE,
  MemoryForm,
  type MoodType,
  type UploadStatus,
  type WithType,
} from "@/components/moodot/memory-form"
import { reverseGeocode } from "@/lib/location/reverse-geocode"

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toMemoryAtIso(memoryAt: string): string | null {
  const date = memoryAt ? new Date(memoryAt) : new Date()
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function EditMemoryPage() {
  const params   = useParams<{ id: string }>()
  const router   = useRouter()
  const memoryId = Number(params.id)

  // form state
  const [mood,            setMood]            = useState<MoodType>("good")
  const [withWho,         setWithWho]         = useState<WithType>("solo")
  const [memoryAt,        setMemoryAt]        = useState("")
  const [title,           setTitle]           = useState("")
  const [text,            setText]            = useState("")
  const [imageUrl,        setImageUrl]        = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadStatus,    setUploadStatus]    = useState<UploadStatus>("idle")
  const [locationLabel,   setLocationLabel]   = useState("")
  const [locationLat,     setLocationLat]     = useState<number | null>(null)
  const [locationLng,     setLocationLng]     = useState<number | null>(null)
  const [placeName,       setPlaceName]       = useState("")
  const [isSaving,        setIsSaving]        = useState(false)
  const [isLoading,       setIsLoading]       = useState(true)

  // ── 기존 기록 로드 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const data = await getMemoryById(memoryId)
        setMood(EMOTION_ID_REVERSE[data.emotion_id ?? 1] ?? "good")
        setWithWho((data.with_whom ?? "Solo").toLowerCase() === "together" ? "together" : "solo")
        setMemoryAt(toDatetimeLocal(data.memory_at))
        setTitle(data.title ?? "")
        setText(data.text ?? "")
        setImageUrl(data.image_url ?? null)
        if (data.image_url) {
          getSignedUrl(data.image_url)
            .then((url) => setImagePreviewUrl(url))
            .catch(() => setImagePreviewUrl(null))
          setUploadStatus("success")
        } else {
          setImagePreviewUrl(null)
        }
        setLocationLabel(data.location_label ?? "")
        setLocationLat(data.location_lat ?? null)
        setLocationLng(data.location_lng ?? null)
        setPlaceName(data.place_name ?? "")
      } catch (e) {
        logger.error("[memory/edit] load error:", e)
        alert("기존 기록을 불러오지 못했습니다.")
        router.back()
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [memoryId, router])

  const handlePhotoUpload = async (file: File) => {
    setUploadStatus("uploading")
    try {
      const uploadFile = await compressImage(file)
      const path = await uploadImage(uploadFile)
      setImageUrl(path)
      setUploadStatus("success")
    } catch (e) {
      logger.error("[memory/edit] photo upload error:", e)
      setUploadStatus("failed")
      alert(`사진 업로드 실패: ${e instanceof Error ? e.message : ""}`)
    }
  }

  const handlePhotoSelected = (file: File) => {
    if (imagePreviewUrl && imagePreviewUrl !== imageUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImagePreviewUrl(URL.createObjectURL(file))
    void handlePhotoUpload(file)
  }

  const handleLocationSelect = async (lat: number, lng: number) => {
    const label = await reverseGeocode(lat, lng)
    setLocationLat(lat)
    setLocationLng(lng)
    setLocationLabel(label)
  }

  // 위치 초기화 — 상태 초기화
  const handleClearLocation = () => {
    setLocationLat(null)
    setLocationLng(null)
    setLocationLabel("")
  }

  const handleDelete = async () => {
    if (!confirm("이 기록을 삭제할까요? 되돌릴 수 없습니다.")) return
    try {
      await deleteMemory(memoryId)
      router.replace("/records")
    } catch (e) {
      logger.error("[memory/edit] delete error:", e)
      alert(`삭제 실패: ${e instanceof Error ? e.message : ""}`)
    }
  }

  // 감정만 필수 — 나머지는 선택, memoryAt 빈값 시 현재 시각으로 대체
  const handleSave = async () => {
    if (uploadStatus === "uploading") { alert("사진 업로드가 완료된 후 저장해 주세요."); return }

    const memoryAtIso = toMemoryAtIso(memoryAt)
    if (!memoryAtIso) {
      alert("날짜 형식이 올바르지 않습니다.")
      return
    }

    const input = {
      title:          title.trim() || null,
      text:           text.trim() || null,
      image_url:      imageUrl,
      emotion_id:     EMOTION_ID_MAP[mood],
      with_whom:      withWho === "solo" ? "Solo" : "Together",
      memory_at:      memoryAtIso,
      location_lat:   locationLat,
      location_lng:   locationLng,
      location_label: locationLabel.trim() || null,
      place_name:     placeName.trim() || null,
    }
    const validation = validateMemoryMutationInput(input)
    if (!validation.ok) {
      alert(validation.error)
      return
    }

    setIsSaving(true)
    try {
      await updateMemory(memoryId, validation.value)
      router.push(`/memory/${memoryId}`)
    } catch (e) {
      logger.error("[memory/edit] save error:", e)
      alert(`저장 실패: ${e instanceof Error ? e.message : ""}`)
    } finally {
      setIsSaving(false)
    }
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mb-bg">
        <p className="text-sm text-mb-muted">불러오는 중...</p>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-mb-bg text-mb-dark">
      {/* Header */}
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
          <h1 className="font-heading text-lg font-bold tracking-tight text-mb-dark">Edit Memory</h1>
          <div className="w-5" />
        </div>
      </header>

      <main className="mx-auto flex max-w-[375px] flex-col gap-3 px-5 pb-32 pt-24">
        <MemoryForm
          mode="edit"
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
          onLocationSelect={handleLocationSelect}
          onClearLocation={handleClearLocation}
          isSaving={isSaving}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      </main>

      <BottomNavigation />
    </div>
  )
}
