import { useForm, useFieldArray, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CreateInvoiceFormSchema, type CreateInvoiceInput } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'
import { VendorCombobox } from '@/components/VendorCombobox'
import { InvoiceFields, RequiredMark, type ItemRowValue } from '@/components/InvoiceFields'
import { useProperties } from '@/hooks/useProperties'
import { useVendors } from '@/hooks/useVendors'

type FormInput = z.input<typeof CreateInvoiceFormSchema>

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
 * Invoice form validated against the shared CreateInvoiceFormSchema. Used for both
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
    resolver: zodResolver(CreateInvoiceFormSchema) as Resolver<
      FormInput,
      unknown,
      CreateInvoiceInput
    >,
    defaultValues: {
      currency: 'USD',
      items: [{ description: '', quantity: 1, total: 0 }],
      ...defaultValues,
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchedVendorName = watch('vendorName')
  const watchedItems = watch('items')
  const computedTotal = (watchedItems ?? []).reduce(
    (sum, item) => sum + (Number(item?.total) || 0),
    0,
  )

  // Bridge react-hook-form's field array to the shared block's row shape. The
  // shared component is controlled and library-agnostic (the vendor form uses
  // plain state), so values come from `watch` and edits go back via `setValue`
  // — validation still runs through the resolver on submit.
  const itemRows: ItemRowValue[] = fields.map((field, index) => ({
    id: field.id,
    description: watchedItems?.[index]?.description ?? '',
    quantity: String(watchedItems?.[index]?.quantity ?? 1),
    total: String(watchedItems?.[index]?.total ?? ''),
  }))
  const onItemChange = (id: string, patch: Partial<ItemRowValue>) => {
    const index = fields.findIndex((f) => f.id === id)
    if (index < 0) return
    if (patch.description !== undefined) {
      setValue(`items.${index}.description`, patch.description, { shouldDirty: true })
    }
    // Numeric fields are strings in the shared block (a half-typed "1." must not
    // become NaN under the cursor); the schema coerces on submit.
    if (patch.quantity !== undefined) {
      setValue(`items.${index}.quantity`, Number(patch.quantity) as never, { shouldDirty: true })
    }
    if (patch.total !== undefined) {
      setValue(`items.${index}.total`, Number(patch.total) as never, { shouldDirty: true })
    }
  }
  /** The date input needs yyyy-mm-dd; defaultValues may hand back a Date. */
  const dateValue = (v: unknown): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string) ?? '')
  const onItemRemove = (id: string) => {
    const index = fields.findIndex((f) => f.id === id)
    if (index >= 0) remove(index)
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border bg-card p-6"
      noValidate
    >
      <div>
        <label htmlFor="vendorName" className="block text-sm font-medium mb-1">
          {t('invoiceForm.vendor')}
          <RequiredMark />
        </label>
        <VendorCombobox
          id="vendorName"
          value={watchedVendorName ?? ''}
          vendors={vendors}
          className={fieldClass}
          field={register('vendorName', {
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
          onPick={(v) => {
            setValue('vendorName', v.name, { shouldDirty: true, shouldValidate: true })
            setValue('vendorId', v.id, { shouldDirty: true })
          }}
        />
        <input type="hidden" {...register('vendorId')} />
        {errors.vendorName && (
          <p className="mt-1 text-sm text-destructive">{errors.vendorName.message}</p>
        )}
      </div>

      {/* Everything below the vendor picker is the shared block, in the same
          order and design the vendor submission form uses. */}
      <InvoiceFields
        items={itemRows}
        onItemChange={onItemChange}
        onItemAdd={() => append({ description: '', quantity: 1, total: 0 })}
        onItemRemove={onItemRemove}
        computedTotal={computedTotal}
        invoiceDate={dateValue(watch('invoiceDate'))}
        onInvoiceDate={(v) => setValue('invoiceDate', v, { shouldDirty: true })}
        propertyId={watch('propertyId') ?? ''}
        onPropertyId={(v) => setValue('propertyId', v, { shouldDirty: true })}
        properties={properties}
        category={watch('category') ?? ''}
        onCategory={(v) =>
          setValue('category', (v || undefined) as FormInput['category'], { shouldDirty: true })
        }
        notes={watch('notes') ?? ''}
        onNotes={(v) => setValue('notes', v, { shouldDirty: true })}
        partsOrdered={watch('partsOrdered') ?? ''}
        onPartsOrdered={(v) => setValue('partsOrdered', v, { shouldDirty: true })}
        errors={{
          items: errors.items?.message ?? errors.items?.root?.message,
          invoiceDate: errors.invoiceDate?.message,
          propertyId: errors.propertyId?.message,
        }}
        noPropertiesHint={
          noProperties ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('invoiceForm.noProperties')}{' '}
              <Link to="/properties" className="text-primary underline">
                {t('invoiceForm.addOne')}
              </Link>{' '}
              {t('invoiceForm.toAssignAndApprove')}
            </p>
          ) : null
        }
      />

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('invoiceForm.saving') : (submitLabel ?? t('invoiceForm.createInvoice'))}
      </Button>
    </form>
  )
}
