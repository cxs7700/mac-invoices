import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'

type InvoiceFields = {
  description: string
  date: Date
  location: string
  price: number
  status: string
  number: number
  quantity: number
  creatorId: number
}

function InvoiceNew() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InvoiceFields>()

  const onSubmit = handleSubmit((data) => {
    console.log(data)
  })

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-2xl">
        <div className="bg-card border border-border rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Create Invoice</h1>
          <p className="text-muted-foreground mb-8">
            Fill in the details below to create a new invoice
          </p>

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Description */}
              <div className="md:col-span-2">
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Description
                </label>
                <input
                  id="description"
                  type="text"
                  {...register('description', { required: 'Description is required' })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="Enter invoice description"
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
                )}
              </div>

              {/* Date */}
              <div>
                <label htmlFor="date" className="block text-sm font-medium text-foreground mb-2">
                  Date
                </label>
                <input
                  id="date"
                  type="date"
                  {...register('date', { required: 'Date is required' })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                />
                {errors.date && (
                  <p className="mt-1 text-sm text-destructive">{errors.date.message}</p>
                )}
              </div>

              {/* Location */}
              <div>
                <label
                  htmlFor="location"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Location
                </label>
                <input
                  id="location"
                  type="text"
                  {...register('location', { required: 'Location is required' })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="Enter location"
                />
                {errors.location && (
                  <p className="mt-1 text-sm text-destructive">{errors.location.message}</p>
                )}
              </div>

              {/* Price */}
              <div>
                <label htmlFor="price" className="block text-sm font-medium text-foreground mb-2">
                  Price
                </label>
                <input
                  id="price"
                  type="number"
                  step="0.01"
                  {...register('price', {
                    required: 'Price is required',
                    min: { value: 0, message: 'Price must be positive' },
                  })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="0.00"
                />
                {errors.price && (
                  <p className="mt-1 text-sm text-destructive">{errors.price.message}</p>
                )}
              </div>

              {/* Status */}
              <div>
                <label htmlFor="status" className="block text-sm font-medium text-foreground mb-2">
                  Status
                </label>
                <input
                  id="status"
                  type="text"
                  {...register('status', { required: 'Status is required' })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="e.g., Pending, Paid"
                />
                {errors.status && (
                  <p className="mt-1 text-sm text-destructive">{errors.status.message}</p>
                )}
              </div>

              {/* Number */}
              <div>
                <label htmlFor="number" className="block text-sm font-medium text-foreground mb-2">
                  Invoice Number
                </label>
                <input
                  id="number"
                  type="number"
                  {...register('number', {
                    required: 'Invoice number is required',
                    min: { value: 1, message: 'Invoice number must be positive' },
                  })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="Enter invoice number"
                />
                {errors.number && (
                  <p className="mt-1 text-sm text-destructive">{errors.number.message}</p>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label
                  htmlFor="quantity"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Quantity
                </label>
                <input
                  id="quantity"
                  type="number"
                  {...register('quantity', {
                    required: 'Quantity is required',
                    min: { value: 1, message: 'Quantity must be at least 1' },
                  })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="Enter quantity"
                />
                {errors.quantity && (
                  <p className="mt-1 text-sm text-destructive">{errors.quantity.message}</p>
                )}
              </div>

              {/* Creator ID */}
              <div>
                <label
                  htmlFor="creatorId"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Creator ID
                </label>
                <input
                  id="creatorId"
                  type="number"
                  {...register('creatorId', {
                    required: 'Creator ID is required', // TODO: Remove this, and just call creatorId with 1 (or do a dropdown with names that map to creatorIds)
                    min: { value: 1, message: 'Creator ID must be positive' },
                  })}
                  className="w-full px-4 py-2.5 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                  placeholder="Enter creator ID"
                />
                {errors.creatorId && (
                  <p className="mt-1 text-sm text-destructive">{errors.creatorId.message}</p>
                )}
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <Button type="submit" className="flex-1 md:flex-none md:px-8">
                Create Invoice
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.reload()}
                className="flex-1 md:flex-none md:px-8"
              >
                Reset
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default InvoiceNew
