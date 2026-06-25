import { useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { StatusBadge } from '@/components/StatusBadge'
import { PhotoAttach } from '@/components/PhotoAttach'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/button'
import { formatMoney, formatDate } from '@/lib/format'
import {
  useSubmissionStatus,
  useSubmit,
  useWithdraw,
  uploadSubmissionPhoto,
} from '@/hooks/useSubmission'
import type { SubmissionStatus } from '@mac-invoices/shared'

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">{t('contractorSubmit.title')}</h1>
          {/* Public page: no session, so the toggle persists locally only. */}
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  )
}

export default function ContractorSubmit() {
  const { token } = useParams()
  const { t } = useTranslation()
  const status = useSubmissionStatus(token!)
  const submit = useSubmit(token!)
  const withdraw = useWithdraw(token!)

  const [amount, setAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [description, setDescription] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)

  if (status.isPending) {
    return (
      <Shell>
        <p className="text-muted-foreground">{t('contractorSubmit.loading')}</p>
      </Shell>
    )
  }
  // A 404 (or any failure) on the status query means the token is invalid/revoked.
  if (status.isError) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="font-medium text-foreground">{t('contractorSubmit.inactiveTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('contractorSubmit.inactiveBody')}</p>
        </div>
      </Shell>
    )
  }

  const submissions = status.data.data
  const canSubmit = !!photoUrl && Number(amount) > 0 && !!invoiceDate && description.trim().length > 0

  const submitError =
    submit.error instanceof ApiError
      ? submit.error.status === 429
        ? t('contractorSubmit.rateLimited')
        : submit.error.message
      : submit.error
        ? t('contractorSubmit.genericError')
        : null

  const resetForm = () => {
    setAmount('')
    setInvoiceDate('')
    setDescription('')
    setPhotoUrl(null)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !photoUrl) return
    submit.mutate(
      {
        amount: Number(amount),
        description: description.trim(),
        invoiceDate,
        image: { url: photoUrl, type: 'OTHER' },
      },
      {
        onSuccess: () => {
          resetForm()
          setJustSubmitted(true)
        },
      },
    )
  }

  const startNew = () => {
    setJustSubmitted(false)
    resetForm()
  }

  return (
    <Shell>
      {justSubmitted ? (
        <div className="rounded-lg border border-status-paid bg-status-paid/30 p-5 text-center">
          <p className="font-medium text-foreground">{t('contractorSubmit.submittedTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('contractorSubmit.submittedBody')}</p>
          <Button className="mt-4" onClick={startNew}>
            {t('contractorSubmit.submitAnother')}
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div>
            <label htmlFor="amount" className="text-sm font-medium text-foreground">
              {t('contractorSubmit.amount')}
            </label>
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="invoiceDate" className="text-sm font-medium text-foreground">
              {t('contractorSubmit.date')}
            </label>
            <input
              id="invoiceDate"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="description" className="text-sm font-medium text-foreground">
              {t('contractorSubmit.description')}
            </label>
            <textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <span className="text-sm font-medium text-foreground">{t('contractorSubmit.photoLabel')}</span>
            <div className="mt-1">
              <PhotoAttach
                onUploaded={setPhotoUrl}
                upload={(file, onProgress) => uploadSubmissionPhoto(token!, file, onProgress)}
              />
            </div>
            {photoUrl && (
              <p className="mt-1 text-xs text-status-paid-foreground">{t('contractorSubmit.photoAttached')}</p>
            )}
            {!photoUrl && (
              <p className="mt-1 text-xs text-muted-foreground">{t('contractorSubmit.photoRequired')}</p>
            )}
          </div>
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!canSubmit || submit.isPending}>
            {submit.isPending ? t('contractorSubmit.submitting') : t('contractorSubmit.submit')}
          </Button>
        </form>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">{t('contractorSubmit.yourSubmissions')}</h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('contractorSubmit.noSubmissions')}</p>
        ) : (
          <ul className="space-y-2">
            {submissions.map((s) => (
              <SubmissionRow
                key={s.id}
                submission={s}
                onWithdraw={() => withdraw.mutate(s.id)}
                onResubmit={startNew}
                withdrawing={withdraw.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </Shell>
  )
}

function SubmissionRow({
  submission: s,
  onWithdraw,
  onResubmit,
  withdrawing,
}: {
  submission: SubmissionStatus
  onWithdraw: () => void
  onResubmit: () => void
  withdrawing: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground tabular-nums">{formatMoney(s.amount)}</span>
        <StatusBadge status={s.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatDate(s.invoiceDate)} · {s.description}
      </p>
      {s.status === 'REJECTED' && (
        <div className="mt-2 text-xs">
          {s.rejectionReason && (
            <p className="text-destructive">
              {t('contractorSubmit.rejectedPrefix')} {s.rejectionReason}
            </p>
          )}
          <button type="button" onClick={onResubmit} className="mt-1 font-medium text-primary underline">
            {t('contractorSubmit.resubmit')}
          </button>
        </div>
      )}
      {s.status === 'SUBMITTED' && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={withdrawing}
          onClick={onWithdraw}
        >
          {t('contractorSubmit.withdraw')}
        </Button>
      )}
    </li>
  )
}
