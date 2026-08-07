import { useForm, useFieldArray, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  CreateInvoiceSchema,
  InvoiceCategory,
  propertyLabel,
  type CreateInvoiceInput,
} from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'
import { useProperties } from '@/hooks/useProperties'
import { useVendors } from '@/hooks/useVendors'
import { formatMoney } from '@/lib/format'

// Derived from the shared enum so the options stay in sync with the schema.
const CATEGORIES = InvoiceCategory.options

type FormInput = z.input<typeof CreateInvoiceSchema>

type Props = {
  onSubmit: (values: CreateInvoiceInput) => void
  defaultValues?: Partial<FormInput>
  isSubmitting?: boolean
  serverError?: string | null
  submitLabel?: string
}

const fieldClass =
  'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

/**
 * Invoice form validated against the shared CreateInvoiceSchema. Used for both
 * create (empty defaults) and edit (prefilled defaults) — a full payload is a
 * valid superset of the PATCH UpdateInvoiceSchema, so one schema covers both.
 */
export function InvoiceForm({
  onSubmit,
  defaultValues,
  isSubmitting,
  serverError,
  submitLabel,
}: Props) {
  const { t } = useTranslation()
  const { data: propData, isPending: propsLoading, isError: propsError } = useProperties()
  const properties = propData?.data ?? []
  const noProperties = !propsLoading && !propsError && properties.length === 0

  // A fetch failure must never block invoice creation — render the field with
  // an empty option list rather than hiding it or blocking submission.
  const { data: vendorData } = useVendors()
  const vendors = vendorData?.data ?? []

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormInput, unknown, CreateInvoiceInput>({
    // zod v4 + @hookform/resolvers types don't line up with the 3-generic useForm;
    // the resolver behaves correctly at runtime, so assert the matching shape.
    resolver: zodResolver(CreateInvoiceSchema) as Resolver<FormInput, unknown, CreateInvoiceInput>,
    defaultValues: {
      currency: 'USD',
      category: 'OTHER',
      items: [{ description: '', quantity: 1, total: 0 }],
      ...defaultValues,
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchedItems = watch('items')
  const computedTotal = (watchedItems ?? []).reduce(
    (sum, item) => sum + (Number(item?.total) || 0),
    0,
  )

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border bg-card p-6"
      noValidate
    >
      <div>
        <label htmlFor="vendorName" className="block text-sm font-medium mb-1">
          {t('invoiceForm.vendor')}
        </label>
        <input
          id="vendorName"
          list="vendor-options"
          autoComplete="off"
          className={fieldClass}
          {...register('vendorName', {
            // Typing after a pick must drop the stale id, or the invoice would
            // be linked to a vendor whose name no longer matches what was
            // typed. Matched by exact string equality — the server already
            // resolves case-insensitively, so a client-side near-match would
            // set an id the user did not actually choose.
            onChange: (e) => {
              const match = vendors.find((v) => v.name === e.target.value)
              setValue('vendorId', match?.id, { shouldDirty: true })
            },
          })}
        />
        <datalist id="vendor-options">
          {vendors.map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
        <input type="hidden" {...register('vendorId')} />
        {errors.vendorName && (
          <p className="mt-1 text-sm text-destructive">{errors.vendorName.message}</p>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-sm font-medium">{t('invoiceForm.items.title')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ description: '', quantity: 1, total: 0 })}
          >
            {t('invoiceForm.items.add')}
          </Button>
        </div>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[1fr_5rem_7rem_auto] items-start gap-2">
              <div>
                <label htmlFor={`items.${index}.description`} className="sr-only">
                  {t('invoiceForm.items.description')}
                </label>
                <input
                  id={`items.${index}.description`}
                  placeholder={t('invoiceForm.items.description')}
                  className={fieldClass}
                  {...register(`items.${index}.description`)}
                />
                {errors.items?.[index]?.description && (
                  <p className="mt-1 text-sm text-destructive">
                    {errors.items[index]?.description?.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`items.${index}.quantity`} className="sr-only">
                  {t('invoiceForm.items.quantity')}
                </label>
                <input
                  id={`items.${index}.quantity`}
                  type="number"
                  step="1"
                  placeholder={t('invoiceForm.items.quantity')}
                  className={fieldClass}
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
                {errors.items?.[index]?.quantity && (
                  <p className="mt-1 text-sm text-destructive">
                    {errors.items[index]?.quantity?.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`items.${index}.total`} className="sr-only">
                  {t('invoiceForm.items.total')}
                </label>
                <input
                  id={`items.${index}.total`}
                  type="number"
                  step="0.01"
                  placeholder={t('invoiceForm.items.total')}
                  className={fieldClass}
                  {...register(`items.${index}.total`, { valueAsNumber: true })}
                />
                {errors.items?.[index]?.total && (
                  <p className="mt-1 text-sm text-destructive">
                    {errors.items[index]?.total?.message}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fields.length <= 1}
                aria-label={t('invoiceForm.items.remove')}
                onClick={() => remove(index)}
              >
                {t('invoiceForm.items.remove')}
              </Button>
            </div>
          ))}
        </div>
        {errors.items && typeof errors.items.message === 'string' && (
          <p className="mt-1 text-sm text-destructive">{errors.items.message}</p>
        )}
        <p className="mt-2 text-sm font-medium">
          {t('invoiceForm.items.computedTotal')}: {formatMoney(computedTotal)}
        </p>
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium mb-1">
          {t('invoiceForm.category')}
        </label>
        <select id="category" className={fieldClass} {...register('category')}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="invoiceDate" className="block text-sm font-medium mb-1">
          {t('invoiceForm.invoiceDate')}
        </label>
        <input id="invoiceDate" type="date" className={fieldClass} {...register('invoiceDate')} />
        {errors.invoiceDate && (
          <p className="mt-1 text-sm text-destructive">{errors.invoiceDate.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="propertyId" className="block text-sm font-medium mb-1">
          {t('invoiceForm.property')}
        </label>
        <select
          id="propertyId"
          className={fieldClass}
          disabled={propsLoading || propsError}
          {...register('propertyId', { setValueAs: (v) => v || undefined })}
        >
          <option value="">{t('invoiceForm.none')}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyLabel(p)}
            </option>
          ))}
        </select>
        {propsLoading && (
          <p className="mt-1 text-sm text-muted-foreground">{t('invoiceForm.loadingProperties')}</p>
        )}
        {propsError && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('invoiceForm.loadPropertiesError')}
          </p>
        )}
        {noProperties && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('invoiceForm.noProperties')}{' '}
            <Link to="/properties" className="underline">
              {t('invoiceForm.addOne')}
            </Link>{' '}
            {t('invoiceForm.toAssignAndApprove')}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium mb-1">
          {t('invoiceForm.notes')}
        </label>
        <input id="notes" className={fieldClass} {...register('notes')} />
      </div>

      <div>
        <label htmlFor="partsOrdered" className="block text-sm font-medium mb-1">
          {t('invoiceForm.partsOrdered')}
        </label>
        <input id="partsOrdered" className={fieldClass} {...register('partsOrdered')} />
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('invoiceForm.saving') : (submitLabel ?? t('invoiceForm.createInvoice'))}
      </Button>
    </form>
  )
}
