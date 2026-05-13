"use client"

import { useEffect, useRef, useState } from "react"
import { getSignedUrl } from "@/lib/storage/image"

type Props = {
  path: string | null
  alt: string
  className?: string
}

/**
 * Storage path를 받아 signed URL로 변환해 렌더한다.
 * - path 없으면 null 반환 (이미지 없는 메모리는 아무것도 렌더하지 않음)
 * - 로딩 중: animate-pulse placeholder
 * - onError 발생 시 signed URL 재발급 후 src 갱신 (1회만, 무한루프 방지)
 */
export function SignedImage({ path, alt, className }: Props) {
  const [signedImage, setSignedImage] = useState<{ path: string; src: string } | null>(null)
  const hasRetried = useRef(false)
  const src = signedImage?.path === path ? signedImage.src : null

  useEffect(() => {
    if (!path) return
    let cancelled = false
    hasRetried.current = false
    getSignedUrl(path)
      .then((url) => {
        if (!cancelled) setSignedImage({ path, src: url })
      })
      .catch(() => {
        if (!cancelled) setSignedImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return null

  if (!src) {
    return <div className={`bg-mb-unselected animate-pulse ${className ?? ""}`} />
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (hasRetried.current) return
        hasRetried.current = true
        getSignedUrl(path, true)
          .then((url) => setSignedImage({ path, src: url }))
          .catch(() => setSignedImage(null))
      }}
    />
  )
}
