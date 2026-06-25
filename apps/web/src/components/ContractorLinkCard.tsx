import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Contractor } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'

type Props = {
  contractor: Contractor
  // The full plaintext link, present ONLY right after create/regenerate (shown
  // once). Null once dismissed — the server never re-issues it.
  revealedLink: string | null
  onDismissReveal: () => void
  onRegenerate: () => void
  onRevoke: () => void
  busy: boolean
}

export function ContractorLinkCard({
  contractor,
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

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">{contractor.name}</div>
          <div className="text-xs text-muted-foreground">{contractor.contact}</div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            contractor.linkActive
              ? 'bg-status-paid text-status-paid-foreground'
              : 'bg-status-overdue text-status-overdue-foreground'
          }`}
        >
          {contractor.linkActive ? t('contractorCard.linkActive') : t('contractorCard.linkRevoked')}
        </span>
      </div>

      {revealedLink ? (
        <div className="mt-3 space-y-2 rounded-md border border-primary/30 bg-accent/40 p-3">
          <p className="text-xs font-medium text-foreground">{t('contractorCard.copyNow')}</p>
          <code className="block break-all rounded bg-background px-2 py-1 text-xs">{revealedLink}</code>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => copy(revealedLink)}>
              {copied ? t('contractorCard.copied') : t('contractorCard.copyLink')}
            </Button>
            <Button size="sm" variant="outline" onClick={onDismissReveal}>
              {t('contractorCard.doneCopied')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onRegenerate}>
            {contractor.linkActive
              ? t('contractorCard.regenerateLink')
              : t('contractorCard.reissueLink')}
          </Button>
          {contractor.linkActive && (
            <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={onRevoke}>
              {t('contractorCard.revoke')}
            </Button>
          )}
          <span className="self-center text-xs text-muted-foreground">
            {t('contractorCard.linkShownHint')}
          </span>
        </div>
      )}
    </li>
  )
}
