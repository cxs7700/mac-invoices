import { useState } from 'react'
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
          {contractor.linkActive ? 'Link active' : 'Link revoked'}
        </span>
      </div>

      {revealedLink ? (
        <div className="mt-3 space-y-2 rounded-md border border-primary/30 bg-accent/40 p-3">
          <p className="text-xs font-medium text-foreground">
            Copy this link now — it won't be shown again.
          </p>
          <code className="block break-all rounded bg-background px-2 py-1 text-xs">{revealedLink}</code>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => copy(revealedLink)}>
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
            <Button size="sm" variant="outline" onClick={onDismissReveal}>
              Done — I copied it
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onRegenerate}>
            {contractor.linkActive ? 'Regenerate link' : 'Re-issue link'}
          </Button>
          {contractor.linkActive && (
            <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={onRevoke}>
              Revoke
            </Button>
          )}
          <span className="self-center text-xs text-muted-foreground">
            The link is shown only when created or regenerated.
          </span>
        </div>
      )}
    </li>
  )
}
