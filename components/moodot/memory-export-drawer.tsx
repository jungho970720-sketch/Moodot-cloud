"use client"

import { useState } from "react"
import { Drawer } from "vaul"
import { Share2, Copy, Download, Check } from "lucide-react"
import { memoryToMarkdown, memoryToFilename } from "@/lib/export/memory-to-markdown"
import type { MemoryRow } from "@/lib/services/memory"

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface MemoryExportDrawerProps {
  memory: MemoryRow
}

export function MemoryExportDrawer({ memory }: MemoryExportDrawerProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const md = memoryToMarkdown(memory)
    await navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const md = memoryToMarkdown(memory)
    const filename = memoryToFilename(memory)
    downloadText(md, filename)
    setOpen(false)
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 h-14 rounded-full bg-transparent border border-mb-unselected/60 font-heading text-[16px] font-semibold text-mb-muted transition-all duration-200 hover:bg-mb-unselected/30 active:scale-[0.99]"
        >
          <Share2 className="w-4 h-4" />
          내보내기
        </button>
      </Drawer.Trigger>

      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[1200] bg-black/40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[1210] mx-auto max-w-[375px] outline-none">
          <div className="rounded-t-2xl bg-mb-bg px-5 pb-8 pt-4">
            {/* 손잡이 */}
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-mb-unselected" />

            <Drawer.Title className="mb-5 font-heading text-base font-semibold text-mb-dark">
              기록 내보내기
            </Drawer.Title>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-4 rounded-xl bg-mb-card px-5 py-4 text-left transition-colors duration-150 hover:bg-mb-unselected/60 active:scale-[0.99]"
              >
                {copied ? (
                  <Check className="w-5 h-5 flex-shrink-0 text-mb-accent-mint" />
                ) : (
                  <Copy className="w-5 h-5 flex-shrink-0 text-mb-primary" />
                )}
                <div>
                  <p className="font-heading text-sm font-semibold text-mb-dark">
                    {copied ? "복사됐습니다" : "Markdown 복사"}
                  </p>
                  <p className="mt-0.5 font-body text-xs text-mb-muted">
                    클립보드에 Markdown 텍스트 복사
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-4 rounded-xl bg-mb-card px-5 py-4 text-left transition-colors duration-150 hover:bg-mb-unselected/60 active:scale-[0.99]"
              >
                <Download className="w-5 h-5 flex-shrink-0 text-mb-primary" />
                <div>
                  <p className="font-heading text-sm font-semibold text-mb-dark">Markdown 다운로드</p>
                  <p className="mt-0.5 font-body text-xs text-mb-muted">.md 파일로 저장</p>
                </div>
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
