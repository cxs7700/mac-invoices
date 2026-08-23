import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { uploadInvoicePhoto, validateImageFile } from '@/hooks/useImageUpload'

/**
 * Capture or pick a photo and upload it directly to storage. Two affordances
 * (camera + file) so both work on every platform — iOS `capture` would force
 * camera-only. Calls `onUploaded` with the stored blob URL on success.
 *
 * Concurrency is opt-in via `remainingSlots`. Without it the control stays
 * single-shot: the buttons disable while an upload runs, which is what the two
 * landlord callers want — `InvoiceNew` holds a single URL that a second upload
 * would overwrite, and the gallery blocks on its own append mutation anyway.
 *
 * With `remainingSlots` the buttons stay live during an upload, so a vendor
 * standing at a job site can shoot the next receipt while the last one is still
 * going up. The bound matters: the vendor page discards anything past its photo
 * cap, so an unbounded queue would upload a file to storage and then silently
 * drop it — the vendor watching progress reach 100% and then seeing no photo.
 */
export function PhotoAttach({
  onUploaded,
  disabled,
  label = 'photo',
  upload = uploadInvoicePhoto,
  remainingSlots,
}: {
  onUploaded: (url: string) => void
  disabled?: boolean
  label?: string
  // Defaults to the authed invoice upload; the public vendor page passes a
  // token-scoped uploader instead.
  upload?: (file: File, onProgress?: (percent: number) => void) => Promise<string>
  /** Slots left for completed photos. Omit for single-shot behaviour. */
  remainingSlots?: number
}) {
  const { t } = useTranslation()
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // One entry per upload in flight. Single-shot callers never see more than one.
  const [inFlight, setInFlight] = useState<{ id: number; progress: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(0)

  const concurrent = remainingSlots !== undefined
  const noSlotsLeft = concurrent && inFlight.length >= Math.max(0, remainingSlots)
  const busy = concurrent ? noSlotsLeft : inFlight.length > 0

  async function handleFile(file: File | undefined) {
    if (!file) return
    const invalid = validateImageFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    const id = nextId.current++
    setInFlight((prev) => [...prev, { id, progress: 0 }])
    try {
      const url = await upload(file, (progress) =>
        setInFlight((prev) => prev.map((u) => (u.id === id ? { ...u, progress } : u))),
      )
      onUploaded(url)
    } catch {
      setError(t('photo.uploadFailed'))
    } finally {
      setInFlight((prev) => prev.filter((u) => u.id !== id))
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.target.files?.[0])
    e.target.value = '' // allow re-selecting the same file
  }

  const labelText = t(`photo.label_${label}`, label)

  return (
    <div className="space-y-2">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onChange}
      />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          onClick={() => cameraRef.current?.click()}
        >
          {t('photo.take', { label: labelText })}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
        >
          {t('photo.choose', { label: labelText })}
        </Button>
      </div>
      {inFlight.map((u) => (
        <p key={u.id} className="text-xs text-muted-foreground" role="status">
          {t('photo.uploading', { progress: u.progress })}
        </p>
      ))}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
