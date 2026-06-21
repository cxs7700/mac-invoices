import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CreateInvoiceSchema, InvoiceCategory, type CreateInvoiceInput } from '@mac-invoices/shared'
import { Button } from '@/components/ui/button'

// Derived from the shared enum so the options stay in sync with the schema.
const CATEGORIES = InvoiceCategory.options

type FormInput = z.input<typeof CreateInvoiceSchema>

type Props = {
  onSubmit: (values: CreateInvoiceInput) => void
  isSubmitting?: boolean
  serverError?: string | null
}

const fieldClass =
  'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

/** Create-invoice form validated against the shared CreateInvoiceSchema. */
export function InvoiceForm({ onSubmit, isSubmitting, serverError }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, CreateInvoiceInput>({
    // zod v4 + @hookform/resolvers types don't line up with the 3-generic useForm;
    // the resolver behaves correctly at runtime, so assert the matching shape.
    resolver: zodResolver(CreateInvoiceSchema) as Resolver<FormInput, unknown, CreateInvoiceInput>,
    defaultValues: { currency: 'USD', category: 'OTHER' },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="invoiceNumber" className="block text-sm font-medium mb-1">
          Invoice number
        </label>
        <input id="invoiceNumber" className={fieldClass} {...register('invoiceNumber')} />
        {errors.invoiceNumber && (
          <p className="mt-1 text-sm text-destructive">{errors.invoiceNumber.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="vendorName" className="block text-sm font-medium mb-1">
          Vendor
        </label>
        <input id="vendorName" className={fieldClass} {...register('vendorName')} />
        {errors.vendorName && (
          <p className="mt-1 text-sm text-destructive">{errors.vendorName.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <input id="description" className={fieldClass} {...register('description')} />
        {errors.description && (
          <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium mb-1">
            Amount
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
            Category
          </label>
          <select id="category" className={fieldClass} {...register('category')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="invoiceDate" className="block text-sm font-medium mb-1">
          Invoice date
        </label>
        <input id="invoiceDate" type="date" className={fieldClass} {...register('invoiceDate')} />
        {errors.invoiceDate && (
          <p className="mt-1 text-sm text-destructive">{errors.invoiceDate.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium mb-1">
          Notes
        </label>
        <input id="notes" className={fieldClass} {...register('notes')} />
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating…' : 'Create invoice'}
      </Button>
    </form>
  )
}
