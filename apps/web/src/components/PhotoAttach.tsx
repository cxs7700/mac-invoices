import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { uploadInvoicePhoto, validateImageFile } from '@/hooks/useImageUpload'

/**
 * Capture or pick a photo and upload it directly to storage. Two affordances
 * (camera + file) so both work on every platform — iOS `capture` would force
 * camera-only. Calls `onUploaded` with the stored blob URL on success.
 */
export function PhotoAttach({
  onUploaded,
  disabled,
  label = 'photo',
  upload = uploadInvoicePhoto,
}: {
  onUploaded: (url: string) => void
  disabled?: boolean
  label?: string
  // Defaults to the authed invoice upload; the public contractor page passes a
  // token-scoped uploader instead.
  upload?: (file: File, onProgress?: (percent: number) => void) => Promise<string>
}) {
  const { t } = useTranslation()
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    const invalid = validateImageFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setUploading(true)
    setProgress(0)
    try {
      const url = await upload(file, setProgress)
      onUploaded(url)
    } catch {
      setError(t('photo.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.target.files?.[0])
    e.target.value = '' // allow re-selecting the same file
  }

  const labelText = t(`photo.label_${label}`, label)

  return (
    <div className="space-y-2">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onChange} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => cameraRef.current?.click()}>
          {t('photo.take', { label: labelText })}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
          {t('photo.choose', { label: labelText })}
        </Button>
      </div>
      {uploading && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('photo.uploading', { progress })}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
