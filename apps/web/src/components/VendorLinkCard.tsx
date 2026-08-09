import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Pencil } from 'lucide-react'
import { formatPhone, type Vendor, type UpdateVendorInput } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'

type Props = {
  vendor: Vendor
  onSave: (values: UpdateVendorInput) => void
  onReissue: () => void
  onRevoke: () => void
  busy: boolean
  saving?: boolean
  saveError?: string | null
}

const fieldClass = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

/**
 * A vendor row: contact details (editable in place) and their submission link.
 *
 * The link is stable and always copyable — it is derived server-side rather
 * than shown once at creation (DEC-033), so there is no "regenerate" step in
 * the normal flow. Replacing a link is deliberately a two-step revoke →
 * re-issue, which is why the re-issue button only appears once revoked.
 */
export function VendorLinkCard({
  vendor,
  onSave,
  onReissue,
  onRevoke,
  busy,
  saving,
  saveError,
}: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(vendor.phone ?? '')
  const [email, setEmail] = useState(vendor.email ?? '')

  const copy = (text: string) => {
    setCopied(true)
    void navigator.clipboard?.writeText(text).catch(() => {})
    setTimeout(() => setCopied(false), 2000)
  }

  const startEditing = () => {
    setPhone(vendor.phone ?? '')
    setEmail(vendor.email ?? '')
    setEditing(true)
  }

  const save = () => {
    // Empty means "clear this field" — null rather than undefined, which the
    // schema would read as "leave it alone".
    onSave({ phone: phone.trim() || null, email: email.trim() || null })
    setEditing(false)
  }

  const contact = [formatPhone(vendor.phone), vendor.email].filter(Boolean).join(' · ')

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{vendor.name}</div>
          <div className="text-xs text-muted-foreground">
            {contact || t('vendorCard.noContact')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              vendor.linkActive
                ? 'bg-status-paid text-status-paid-foreground'
                : 'bg-status-overdue text-status-overdue-foreground'
            }`}
          >
            {vendor.linkActive ? t('vendorCard.linkActive') : t('vendorCard.linkRevoked')}
          </span>
          {!editing && (
            <button
              type="button"
              aria-label={t('vendorCard.editContact', { name: vendor.name })}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={startEditing}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`phone-${vendor.id}`} className="text-sm font-medium text-foreground">
                {t('vendors.phone')}
              </label>
              <input
                id={`phone-${vendor.id}`}
                type="tel"
                className={fieldClass}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`email-${vendor.id}`} className="text-sm font-medium text-foreground">
                {t('vendors.email')}
              </label>
              <input
                id={`email-${vendor.id}`}
                type="email"
                className={fieldClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          {saveError && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {saveError}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {vendor.link ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
              {vendor.link}
            </code>
            <button
              type="button"
              aria-label={t('vendorCard.copyLinkFor', { name: vendor.name })}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => copy(vendor.link!)}
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('vendorCard.reusableHint')}</span>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={onRevoke}
            >
              {t('vendorCard.revoke')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onReissue}>
            {t('vendorCard.reissueLink')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('vendorCard.revokedHint')}</span>
        </div>
      )}
    </li>
  )
}
