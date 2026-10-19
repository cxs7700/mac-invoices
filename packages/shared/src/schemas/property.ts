import { z } from 'zod'
import { PhoneSchema } from './phone'

// A landlord's rental property — the entity invoices are assigned to so spend can
// be organized by property. Per-landlord; mirrors the Vendor shape. The API
// never returns cross-landlord data (ownership-scoped routes).

// The property's owner — the payee and the PDF's Bill-To. Distinct from the
// account holder, who may be a property manager who never receives payment.
// Name and email are required (the PDF prints both); phone is optional and
// normalized the same way as a vendor's.
const ownerFields = {
  ownerFirstName: z.string().trim().min(1).max(100),
  ownerLastName: z.string().trim().min(1).max(100),
  ownerEmail: z.string().trim().toLowerCase().email().max(200),
}

export const CreatePropertySchema = z.object({
  // Optional friendly label, e.g. "Maple Duplex". When absent, the address is the
  // property's display name (see `propertyLabel`).
  name: z.string().trim().max(100).optional(),
  // Free-text address; structured fields are deferred.
  address: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional(),
  ...ownerFields,
  ownerPhone: PhoneSchema.optional(),
})
// Every field optional; explicit null clears the (optional) owner phone.
export const UpdatePropertySchema = CreatePropertySchema.omit({ ownerPhone: true })
  .partial()
  .extend({ ownerPhone: PhoneSchema.nullish() })

/** "Jane Doe" for a property owner. */
export function ownerFullName(p: {
  ownerFirstName: string | null
  ownerLastName: string | null
}): string {
  return [p.ownerFirstName, p.ownerLastName].filter(Boolean).join(' ')
}

/** The label to show for a property: its name if it has one, else its address.
 * Used everywhere a property is listed (forms, dropdowns, detail header). */
export function propertyLabel(p: { name?: string | null; address: string }): string {
  return p.name?.trim() || p.address
}

/** A property as the landlord lists/views it. */
export const PropertySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  notes: z.string().nullable(),
  // Nullable on read: rows created before owners existed were backfilled from
  // the account holder, whose name may itself be unset.
  ownerFirstName: z.string().nullable(),
  ownerLastName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  ownerPhone: z.string().nullable(),
  createdAt: z.coerce.date(),
})

/** The property detail response: the property plus its total-spend rollup
 * (sum of its invoices' amounts excluding NON_SPEND_STATUSES — the same
 * definition of spend the dashboard uses, per DEC-041), as a string. */
export const PropertyDetailSchema = PropertySchema.extend({
  totalSpend: z.string(),
})

export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>
export type Property = z.infer<typeof PropertySchema>
export type PropertyDetail = z.infer<typeof PropertyDetailSchema>
