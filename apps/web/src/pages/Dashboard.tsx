import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useInvoiceSummary } from '@/hooks/useInvoiceSummary'
import { useInvoices } from '@/hooks/useInvoices'
import { SpendBars } from '@/components/SpendBars'
import { SpendTrendChart } from '@/components/SpendTrendChart'
import { DateRangePicker } from '@/components/DateRangePicker'
import { InvoiceTable } from '@/components/InvoiceTable'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/format'
import { parseListParams, resolvedDates, toSearchParams } from '@/lib/listParams'

export default function Dashboard() {
  const { t } = useTranslation()
  // The dashboard reuses the list's date filter — same parser, same URL keys —
  // so a lookback means the same window in both places and survives a reload.
  // Only the date fields are read here; the rest of the filter set is inert.
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseListParams(searchParams)
  const { from, to } = resolvedDates(filters)

  const setRange = (patch: { range?: string; from?: string; to?: string }) => {
    const next = toSearchParams({ ...filters, ...patch, page: 1 })
    setSearchParams(next, { replace: true })
  }

  const { data: summary, isPending, isError } = useInvoiceSummary({ from, to })
  const recent = useInvoices({ limit: 5, sort: 'invoiceDate', order: 'desc', from, to })

  const header = (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h1>
        <Button asChild>
          <Link to="/invoices/new">{t('dashboard.newInvoice')}</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <DateRangePicker
          value={{ range: filters.range, from: filters.from, to: filters.to }}
          onChange={setRange}
        />
        {filters.range && (
          <button
            type="button"
            onClick={() => setRange({ range: '', from: '', to: '' })}
            className="text-sm text-primary md:self-end md:pb-2"
          >
            {t('dashboard.allTime')}
          </button>
        )}
      </div>
    </>
  )

  if (isPending)
    return (
      <div className="space-y-6">
        {header}
        <div className="text-muted-foreground">{t('dashboard.loading')}</div>
      </div>
    )
  if (isError || !summary)
    return (
      <div className="space-y-6">
        {header}
        <div className="text-muted-foreground">{t('dashboard.loadError')}</div>
      </div>
    )

  const outstanding = summary.byStatus
    .filter((s) => s.status === 'PENDING')
    .reduce((sum, s) => sum + parseFloat(s.amount), 0)

  const catRows = summary.byCategory
    .filter((c) => c.count > 0)
    .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
    .map((c) => ({
      key: c.category,
      label: t(`category.${c.category}`),
      amount: c.amount,
      count: c.count,
    }))

  const statRows = summary.byStatus
    .filter((s) => s.count > 0)
    .map((s) => ({
      key: s.status,
      label: t(`status.${s.status}`),
      amount: s.amount,
      count: s.count,
    }))

  const months = summary.byMonth ?? []
  // Per-month average over the months that actually carry spend, so a long
  // quiet stretch doesn't drag the figure toward zero.
  const activeMonths = months.filter((m) => parseFloat(m.amount) > 0).length
  const perMonth = activeMonths > 0 ? parseFloat(summary.total.amount) / activeMonths : 0

  return (
    <div className="space-y-6">
      {header}

      {summary.total.count === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            {filters.range ? t('dashboard.noInvoicesInRange') : t('dashboard.noInvoicesYet')}
          </p>
          <Button asChild className="mt-3">
            <Link to="/invoices/new">{t('dashboard.createFirst')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('dashboard.totalSpend')} value={formatMoney(summary.total.amount)} />
            <Stat label={t('dashboard.outstanding')} value={formatMoney(outstanding)} />
            <Stat label={t('dashboard.invoices')} value={String(summary.total.count)} />
            <Stat label={t('dashboard.perMonth')} value={formatMoney(perMonth)} />
          </div>

          <Card title={t('dashboard.spendOverTime')}>
            <SpendTrendChart points={months} />
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title={t('dashboard.spendByCategory')}>
              <SpendBars rows={catRows} />
            </Card>
            <Card title={t('dashboard.byStatus')}>
              <SpendBars rows={statRows} />
            </Card>
          </div>

          <Card
            title={t('dashboard.recentInvoices')}
            action={
              <Link to={`/invoices?${toSearchParams(filters)}`} className="text-sm text-primary">
                {t('dashboard.viewAll')}
              </Link>
            }
          >
            {recent.data && recent.data.data.length > 0 ? (
              <InvoiceTable invoices={recent.data.data} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('dashboard.noInvoices')}</p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-bold text-foreground tabular-nums sm:text-2xl">
        {value}
      </div>
    </div>
  )
}

function Card({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}
