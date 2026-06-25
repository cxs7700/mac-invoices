import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CreateInvoiceSchema, InvoiceCategory, type CreateInvoiceInput } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'
import { useProperties } from '@/hooks/useProperties'

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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, CreateInvoiceInput>({
    // zod v4 + @hookform/resolvers types don't line up with the 3-generic useForm;
    // the resolver behaves correctly at runtime, so assert the matching shape.
    resolver: zodResolver(CreateInvoiceSchema) as Resolver<FormInput, unknown, CreateInvoiceInput>,
    defaultValues: { currency: 'USD', category: 'OTHER', ...defaultValues },
  })

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
        <input id="vendorName" className={fieldClass} {...register('vendorName')} />
        {errors.vendorName && (
          <p className="mt-1 text-sm text-destructive">{errors.vendorName.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          {t('invoiceForm.description')}
        </label>
        <input id="description" className={fieldClass} {...register('description')} />
        {errors.description && (
          <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium mb-1">
            {t('invoiceForm.amount')}
          </label>
          <input
            id="amount"
            type="number"
            step="0.01"
            className={fieldClass}
            {...register('amount', { valueAsNumber: true })}
          />
          {errors.amount && (
            <p className="mt-1 text-sm text-destructive">{errors.amount.message}</p>
          )}
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
              {p.name}
            </option>
          ))}
        </select>
        {propsLoading && (
          <p className="mt-1 text-sm text-muted-foreground">{t('invoiceForm.loadingProperties')}</p>
        )}
        {propsError && (
          <p className="mt-1 text-sm text-muted-foreground">{t('invoiceForm.loadPropertiesError')}</p>
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

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('invoiceForm.saving') : (submitLabel ?? t('invoiceForm.createInvoice'))}
      </Button>
    </form>
  )
}
