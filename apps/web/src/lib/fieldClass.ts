/**
 * Shared input styling for the app's forms.
 *
 * This string was copy-pasted identically into three components; it lives here
 * so a change like the one below lands everywhere at once.
 *
 * `text-base md:text-sm` is load-bearing, not cosmetic. Mobile Safari zooms the
 * viewport whenever a focused input's font-size is under 16px, and it does not
 * zoom back out when the field blurs — so a vendor filling in the submission
 * form on an iPhone ends up panning a magnified page for the rest of the visit.
 * 16px on small screens prevents it; the denser 14px returns at `md:`, where
 * there is no touch keyboard and no zoom behaviour to trigger.
 */
export const fieldClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm'

/** The same, for the tighter itemized-line inputs (no top margin, less padding). */
export const itemFieldClass =
  'w-full rounded-md border border-input bg-background px-2 py-2 text-base md:text-sm'
