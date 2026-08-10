/**
 * Normalize a phone number to `123-456-7890`.
 *
 * Only North-American 10-digit numbers are reformatted (an 11-digit number
 * with a leading country code `1` counts, and the `1` is dropped). Anything
 * else — an international number, an extension, a partially typed value — is
 * returned trimmed but otherwise untouched, because forcing it into a 10-digit
 * shape would corrupt a number the landlord entered correctly.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (raw == null) return ''
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')

  // An 11-digit number is only a US number with a country code if it starts
  // with 1; +44… must not have its leading digit thrown away.
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length !== 10) return trimmed

  // A leading '+' means the caller wrote an international number; a 10-digit
  // one is ambiguous enough that reformatting it would be a guess.
  if (trimmed.startsWith('+') && digits.length !== 11) return trimmed

  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
}
