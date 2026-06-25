import { z } from 'zod'

// A landlord's rental property — the entity invoices are assigned to so spend can
// be organized by property. Per-landlord; mirrors the Contractor shape. The API
// never returns cross-landlord data (ownership-scoped routes).

export const CreatePropertySchema = z.object({
  // A label or street line, e.g. "123 Main St" or "Maple Duplex".
  name: z.string().trim().min(1).max(100),
  // Free-text address; structured fields are deferred.
  address: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional(),
})
export const UpdatePropertySchema = CreatePropertySchema.partial()

/** A property as the landlord lists/views it. */
export const PropertySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  notes: z.string().nullable(),
  createdAt: z.coerce.date(),
})

/** The property detail response: the property plus its total-spend rollup
 * (sum of its invoices' amounts excluding REJECTED/CANCELLED), as a string. */
export const PropertyDetailSchema = PropertySchema.extend({
  totalSpend: z.string(),
})

export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>
export type Property = z.infer<typeof PropertySchema>
export type PropertyDetail = z.infer<typeof PropertyDetailSchema>
