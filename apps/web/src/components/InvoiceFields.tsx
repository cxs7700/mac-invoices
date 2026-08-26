import { Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { InvoiceCategory, propertyLabel } from '@mac-invoices/shared'
import { formatMoney } from '@/lib/format'
import { fieldClass, itemFieldClass } from '@/lib/fieldClass'

/**
 * The fields both invoice forms share, in one order and one design.
 *
 * The landlord's create/edit form and the vendor's no-login submission form had
 * drifted into two different layouts for the same six fields. This is the
 * submission page's card treatment, used by both; each form keeps only what is
 * genuinely its own — the vendor combobox on the landlord side, photos on the
 * vendor side — and renders them around this block.
 *
 * Deliberately controlled and form-library-agnostic: the landlord form is
 * react-hook-form and the vendor form is plain useState, so this takes values
 * and change handlers rather than reaching for a form context that only one of
 * them has.
 */

export type ItemRowValue = { id: string; description: string; quantity: string; total: string }

/** Quantity as a number; a half-typed or empty box reads 1. */
function quantityOf(row: Pick<ItemRowValue, 'quantity'>): number {
  return Math.max(1, Number(row.quantity) || 1)
}

type Props = {
  items: ItemRowValue[]
  onItemChange: (id: string, patch: Partial<ItemRowValue>) => void
  onItemAdd: () => void
  onItemRemove: (id: string) => void
  computedTotal: number

  invoiceDate: string
  onInvoiceDate: (value: string) => void

  propertyId: string
  onPropertyId: (value: string) => void
  properties: { id: string; name?: string | null; address: string }[]

  category: string
  onCategory: (value: string) => void

  notes: string
  onNotes: (value: string) => void

  partsOrdered: string
  onPartsOrdered: (value: string) => void

  /** Per-field messages, keyed by field name; the two forms validate differently. */
  errors?: Partial<Record<'items' | 'invoiceDate' | 'propertyId', string | undefined>>
  /** Rendered under the property select when the landlord has none yet. */
  noPropertiesHint?: React.ReactNode
}

export function InvoiceFields({
  items,
  onItemChange,
  onItemAdd,
  onItemRemove,
  computedTotal,
  invoiceDate,
  onInvoiceDate,
  propertyId,
  onPropertyId,
  properties,
  category,
  onCategory,
  notes,
  onNotes,
  partsOrdered,
  onPartsOrdered,
  errors,
  noPropertiesHint,
}: Props) {
  const { t } = useTranslation()
  const optional = t('invoiceFields.optionalSuffix')

  const stepQuantity = (row: ItemRowValue, delta: number) =>
    onItemChange(row.id, { quantity: String(Math.max(1, quantityOf(row) + delta)) })

  return (
    <>
      {/* 1 — Work performed */}
      <div>
        <div className="mb-1">
          <span className="text-sm font-medium text-foreground">
            {t('invoiceFields.items.title')}
          </span>
        </div>
        <div className="space-y-2">
          {items.map((row, index) => (
            <div key={row.id} className="rounded-md border border-border bg-background/40 p-3">
              {/* Description gets the full width of the card — it is the field
                  with the most to say. */}
              <label htmlFor={`item-desc-${row.id}`} className="sr-only">
                {t('invoiceFields.items.description')}
              </label>
              <input
                id={`item-desc-${row.id}`}
                placeholder={t('invoiceFields.items.description')}
                value={row.description}
                onChange={(e) => onItemChange(row.id, { description: e.target.value })}
                className={itemFieldClass}
              />

              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <label
                    htmlFor={`item-qty-${row.id}`}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    {t('invoiceFields.items.quantity')}
                  </label>
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      aria-label={t('invoiceFields.items.decrement', { index: index + 1 })}
                      onClick={() => stepQuantity(row, -1)}
                      className="min-h-11 min-w-11 rounded-l-md border border-input px-2 text-muted-foreground hover:bg-accent disabled:opacity-40 md:min-h-0 md:min-w-0"
                      disabled={quantityOf(row) <= 1}
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <input
                      id={`item-qty-${row.id}`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      value={row.quantity}
                      onChange={(e) => onItemChange(row.id, { quantity: e.target.value })}
                      className="min-h-11 w-14 border-y border-input bg-background px-1 py-2 text-center text-base md:min-h-0 md:text-sm"
                    />
                    <button
                      type="button"
                      aria-label={t('invoiceFields.items.increment', { index: index + 1 })}
                      onClick={() => stepQuantity(row, 1)}
                      className="min-h-11 min-w-11 rounded-r-md border border-input px-2 text-muted-foreground hover:bg-accent md:min-h-0 md:min-w-0"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="flex-1">
                  <label
                    htmlFor={`item-total-${row.id}`}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    {t('invoiceFields.items.total')}
                  </label>
                  <input
                    id={`item-total-${row.id}`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder={t('invoiceFields.items.total')}
                    value={row.total}
                    onChange={(e) => onItemChange(row.id, { total: e.target.value })}
                    className={itemFieldClass}
                  />
                </div>

                {items.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('invoiceFields.items.remove', { index: index + 1 })}
                    onClick={() => onItemRemove(row.id)}
                    className="mb-1 flex min-h-11 min-w-11 items-center justify-center rounded text-destructive hover:bg-destructive/10 md:min-h-0 md:min-w-0 md:p-1.5"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={onItemAdd}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-2 text-sm text-primary hover:bg-accent md:min-h-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('invoiceFields.items.add')}
          </button>
        </div>
        {errors?.items && <p className="mt-1 text-sm text-destructive">{errors.items}</p>}
        <p className="mt-2 text-right text-sm text-muted-foreground">
          {t('invoiceFields.items.computedTotal')}:{' '}
          <span className="font-medium tabular-nums text-foreground">
            {formatMoney(computedTotal)}
          </span>
        </p>
      </div>

      {/* 2 — Invoice date */}
      <div>
        <label htmlFor="invoiceDate" className="text-sm font-medium text-foreground">
          {t('invoiceFields.invoiceDate')}
        </label>
        <input
          id="invoiceDate"
          type="date"
          value={invoiceDate}
          onChange={(e) => onInvoiceDate(e.target.value)}
          // iOS Safari gives date inputs an intrinsic min-width that overrides
          // w-full and pushes the field past its container; min-w-0 +
          // appearance-none let it shrink to fit.
          className={`${fieldClass} min-w-0 appearance-none`}
        />
        {errors?.invoiceDate && (
          <p className="mt-1 text-sm text-destructive">{errors.invoiceDate}</p>
        )}
      </div>

      {/* 3 — Property (required in both forms) */}
      <div>
        <label htmlFor="propertyId" className="text-sm font-medium text-foreground">
          {t('invoiceFields.property')}
        </label>
        <select
          id="propertyId"
          value={propertyId}
          onChange={(e) => onPropertyId(e.target.value)}
          className={fieldClass}
        >
          <option value="">{t('invoiceFields.selectProperty')}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyLabel(p)}
            </option>
          ))}
        </select>
        {errors?.propertyId && <p className="mt-1 text-sm text-destructive">{errors.propertyId}</p>}
        {noPropertiesHint}
      </div>

      {/* 4 — Category */}
      <div>
        <label htmlFor="category" className="text-sm font-medium text-foreground">
          {t('invoiceFields.category')} {optional}
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => onCategory(e.target.value)}
          className={fieldClass}
        >
          <option value="">{t('invoiceFields.notSpecified')}</option>
          {InvoiceCategory.options.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </div>

      {/* 5 — Notes */}
      <div>
        <label htmlFor="notes" className="text-sm font-medium text-foreground">
          {t('invoiceFields.notes')} {optional}
        </label>
        <textarea
          id="notes"
          rows={2}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          className={fieldClass}
        />
      </div>

      {/* 6 — Parts ordered */}
      <div>
        <label htmlFor="partsOrdered" className="text-sm font-medium text-foreground">
          {t('invoiceFields.partsOrdered')} {optional}
        </label>
        <input
          id="partsOrdered"
          value={partsOrdered}
          onChange={(e) => onPartsOrdered(e.target.value)}
          className={fieldClass}
        />
      </div>
    </>
  )
}
