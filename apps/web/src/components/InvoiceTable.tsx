import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { summarizeItems } from '@mac-invoices/shared'
import type { InvoiceListItem } from '@/hooks/useInvoices'
import { StatusBadge } from './StatusBadge'
import { SyncBadge } from './SyncBadge'
import { formatMoney, formatDate } from '@/lib/format'

const th = 'px-4 py-2 font-medium'
const td = 'px-4 py-2.5'

/** Selection mode for the PDF export: when present, rows grow a leading
 * checkbox and the whole row becomes a toggle hit target (the invoice-number
 * link keeps navigating). */
export type InvoiceTableSelection = {
  // Structural: the page passes its selection Map directly (only .has is needed).
  selectedIds: { has(id: string): boolean }
  disabled: boolean
  onToggle: (invoice: InvoiceListItem) => void
}

export function InvoiceTable({
  invoices,
  selection,
}: {
  invoices: InvoiceListItem[]
  selection?: InvoiceTableSelection
}) {
  const { t } = useTranslation()

  const rowClick = (e: React.MouseEvent, inv: InvoiceListItem) => {
    if (!selection || selection.disabled) return
    // Links and the checkbox itself keep their native behavior.
    if ((e.target as HTMLElement).closest('a, input, button')) return
    // A click that concludes a text-selection drag is a copy, not a toggle.
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    selection.onToggle(inv)
  }

  return (
    <div data-rscroll className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            {selection && <th className={th}>{t('invoiceTable.select')}</th>}
            <th className={th}>{t('invoiceTable.number')}</th>
            <th className={th}>{t('invoiceTable.job')}</th>
            <th className={th}>{t('invoiceTable.partsOrdered')}</th>
            <th className={th}>{t('invoiceTable.vendor')}</th>
            <th className={th}>{t('invoiceTable.date')}</th>
            <th className={`${th} text-right`}>{t('invoiceTable.total')}</th>
            <th className={th}>{t('invoiceTable.status')}</th>
            <th className={th}>{t('invoiceTable.exported')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr
              key={inv.id}
              className={`border-b border-border last:border-0 hover:bg-accent/40 ${
                selection && !selection.disabled ? 'cursor-pointer' : ''
              }`}
              onClick={(e) => rowClick(e, inv)}
            >
              {selection && (
                <td className={td}>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selection.selectedIds.has(inv.id)}
                    disabled={selection.disabled}
                    onChange={() => selection.onToggle(inv)}
                    aria-label={t('invoiceTable.selectInvoice', {
                      number: inv.invoiceNumber ?? '—',
                      vendor: inv.vendorName,
                    })}
                  />
                </td>
              )}
              <td className={td}>
                {/*
                  Vendor submissions carry no number until the landlord approves
                  them, and an empty <Link> renders as an invisible, unclickable
                  cell — which made every pending submission unreachable from
                  this list. Always render a label so the row can be opened.
                */}
                <Link
                  to={`/invoices/${inv.id}`}
                  className="font-medium text-primary"
                  aria-label={t('invoiceTable.openInvoice', {
                    number: inv.invoiceNumber ?? t('invoiceTable.unnumbered'),
                    vendor: inv.vendorName,
                  })}
                >
                  {inv.invoiceNumber ?? t('invoiceTable.unnumbered')}
                </Link>
              </td>
              <td className={`${td} max-w-xs truncate`}>{summarizeItems(inv.items)}</td>
              <td className={`${td} max-w-xs truncate`}>{inv.partsOrdered || '—'}</td>
              <td className={td}>{inv.vendorName}</td>
              <td className={td}>{formatDate(inv.invoiceDate)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatMoney(inv.amount)}</td>
              <td className={td}>
                <StatusBadge status={inv.status} />
              </td>
              <td className={td}>
                <SyncBadge sheetsSyncedAt={inv.sheetsSyncedAt} updatedAt={inv.updatedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
