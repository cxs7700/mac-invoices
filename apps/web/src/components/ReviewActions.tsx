import { useState } from 'react'
import { InvoiceCategory } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'

type Props = {
  onApprove: (category: string) => void
  onReject: (reason: string) => void
  isPending: boolean
}

/** Title-case an enum value for display (REPAIRS → Repairs). */
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

/**
 * Landlord review actions for a SUBMITTED contractor submission. Approve opens a
 * required category picker (the API blocks APPROVED until a category is set, so
 * this enforces it by construction); Reject opens a required reason (surfaced
 * back to the contractor). Mirrors the detail page's two-step confirm pattern.
 */
export function ReviewActions({ onApprove, onReject, isPending }: Props) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [category, setCategory] = useState('')
  const [reason, setReason] = useState('')

  if (mode === 'approve') {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <label htmlFor="approve-category" className="text-xs font-medium text-foreground">
          Set a category to approve
        </label>
        <select
          id="approve-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Select a category…</option>
          {InvoiceCategory.options.map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!category || isPending}
            onClick={() => onApprove(category)}
          >
            Confirm approve
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (mode === 'reject') {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <label htmlFor="reject-reason" className="text-xs font-medium text-foreground">
          Reason (shown to the contractor)
        </label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          placeholder="e.g. Amount doesn't match the receipt"
        />
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!reason.trim() || isPending}
            onClick={() => onReject(reason.trim())}
          >
            Confirm reject
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" disabled={isPending} onClick={() => setMode('approve')}>
        Approve
      </Button>
      <Button
        variant="outline"
        className="w-full text-destructive"
        disabled={isPending}
        onClick={() => setMode('reject')}
      >
        Reject
      </Button>
    </div>
  )
}
