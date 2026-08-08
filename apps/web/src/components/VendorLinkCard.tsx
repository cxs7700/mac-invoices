import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Vendor } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'

type Props = {
  vendor: Vendor
  // The full plaintext link, present ONLY right after create/regenerate (shown
  // once). Null once dismissed — the server never re-issues it.
  revealedLink: string | null
  onDismissReveal: () => void
  onRegenerate: () => void
  onRevoke: () => void
  busy: boolean
}

export function VendorLinkCard({
  vendor,
  revealedLink,
  onDismissReveal,
  onRegenerate,
  onRevoke,
  busy,
}: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = (text: string) => {
    setCopied(true)
    void navigator.clipboard?.writeText(text).catch(() => {})
    setTimeout(() => setCopied(false), 2000)
  }

  const contact = [vendor.phone, vendor.email].filter(Boolean).join(' · ')

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">{vendor.name}</div>
          <div className="text-xs text-muted-foreground">{contact}</div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            vendor.linkActive
              ? 'bg-status-paid text-status-paid-foreground'
              : 'bg-status-overdue text-status-overdue-foreground'
          }`}
        >
          {vendor.linkActive ? t('vendorCard.linkActive') : t('vendorCard.linkRevoked')}
        </span>
      </div>

      {revealedLink ? (
        <div className="mt-3 space-y-2 rounded-md border border-primary/30 bg-accent/40 p-3">
          <p className="text-xs font-medium text-foreground">{t('vendorCard.copyNow')}</p>
          <code className="block break-all rounded bg-background px-2 py-1 text-xs">
            {revealedLink}
          </code>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => copy(revealedLink)}>
              {copied ? t('vendorCard.copied') : t('vendorCard.copyLink')}
            </Button>
            <Button size="sm" variant="outline" onClick={onDismissReveal}>
              {t('vendorCard.doneCopied')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onRegenerate}>
            {vendor.linkActive ? t('vendorCard.regenerateLink') : t('vendorCard.reissueLink')}
          </Button>
          {vendor.linkActive && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={onRevoke}
            >
              {t('vendorCard.revoke')}
            </Button>
          )}
          <span className="self-center text-xs text-muted-foreground">
            {t('vendorCard.linkShownHint')}
          </span>
        </div>
      )}
    </li>
  )
}
