import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { InvoiceCategory, propertyLabel } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'
import { useProperties } from '@/hooks/useProperties'

type Props = {
  onApprove: (category: string, propertyId: string) => void
  onReject: (reason: string) => void
  isPending: boolean
}

/**
 * Landlord review actions for a SUBMITTED contractor submission. Approve opens a
 * required category picker (the API blocks APPROVED until a category is set, so
 * this enforces it by construction); Reject opens a required reason (surfaced
 * back to the contractor). Mirrors the detail page's two-step confirm pattern.
 */
export function ReviewActions({ onApprove, onReject, isPending }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [category, setCategory] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [reason, setReason] = useState('')
  const { data: propData } = useProperties()
  const properties = propData?.data ?? []

  if (mode === 'approve') {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <label htmlFor="approve-category" className="text-xs font-medium text-foreground">
          {t('review.setCategoryAndProperty')}
        </label>
        <select
          id="approve-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">{t('review.selectCategory')}</option>
          {InvoiceCategory.options.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
        <select
          id="approve-property"
          aria-label={t('review.property')}
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">{t('review.selectProperty')}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyLabel(p)}
            </option>
          ))}
        </select>
        {properties.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t('review.noProperties')}{' '}
            <Link to="/properties" className="underline">
              {t('review.addOne')}
            </Link>{' '}
            {t('review.beforeApproving')}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!category || !propertyId || isPending}
            onClick={() => onApprove(category, propertyId)}
          >
            {t('review.confirmApprove')}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
            {t('review.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  if (mode === 'reject') {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <label htmlFor="reject-reason" className="text-xs font-medium text-foreground">
          {t('review.reasonLabel')}
        </label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          placeholder={t('review.reasonPlaceholder')}
        />
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!reason.trim() || isPending}
            onClick={() => onReject(reason.trim())}
          >
            {t('review.confirmReject')}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
            {t('review.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" disabled={isPending} onClick={() => setMode('approve')}>
        {t('review.approve')}
      </Button>
      <Button
        variant="outline"
        className="w-full text-destructive"
        disabled={isPending}
        onClick={() => setMode('reject')}
      >
        {t('review.reject')}
      </Button>
    </div>
  )
}
