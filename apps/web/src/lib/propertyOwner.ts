import { CreatePropertySchema } from '@mac-invoices/shared'

/** The property-owner inputs as plain strings — the forms trim and map them on submit. */
export type OwnerDraft = { firstName: string; lastName: string; email: string; phone: string }

export const EMPTY_OWNER: OwnerDraft = { firstName: '', lastName: '', email: '', phone: '' }

/** True once the required owner fields (first, last, email) are filled and the
 * email passes the same rule the server applies — the browser's own
 * `type="email"` check is looser (it accepts `a@b`), which would otherwise only
 * surface as a 400 after submit. */
export function ownerComplete(o: OwnerDraft): boolean {
  return (
    !!(o.firstName.trim() && o.lastName.trim()) &&
    CreatePropertySchema.shape.ownerEmail.safeParse(o.email).success
  )
}

/** The draft as API fields. A blank phone comes back undefined; the edit form
 * maps that to null so clearing it removes the stored number. */
export function ownerPayload(o: OwnerDraft) {
  return {
    ownerFirstName: o.firstName.trim(),
    ownerLastName: o.lastName.trim(),
    ownerEmail: o.email.trim(),
    ownerPhone: o.phone.trim() || undefined,
  }
}
