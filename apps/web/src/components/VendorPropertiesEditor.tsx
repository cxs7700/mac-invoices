import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { propertyLabel } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { useProperties } from '@/hooks/useProperties'
import { useVendorProperties, useSetVendorProperties } from '@/hooks/useVendors'

/**
 * Assign properties to one vendor. A checkbox list rather than a combobox: a
 * landlord has a handful of properties, and seeing the unchecked ones is the
 * point — the landlord is deciding what this vendor may file against.
 *
 * The whole set is PUT on save, so local state is the draft and the server is
 * only touched once. Mounted lazily by the card, which is why the queries here
 * are unconditional — the component only exists while the section is open.
 */
export function VendorPropertiesEditor({ vendorId }: { vendorId: string }) {
  const { t } = useTranslation()
  const all = useProperties()
  const assigned = useVendorProperties(vendorId)
  const save = useSetVendorProperties(vendorId)

  // The landlord's in-progress edit, or null while they haven't touched
  // anything. Deriving the effective selection from `draft ?? server` rather
  // than seeding state in an effect keeps this a pure render: a refetch that
  // lands mid-edit can't clobber the draft, and there is no cascading render.
  const [draft, setDraft] = useState<Set<string> | null>(null)

  const assignedData = assigned.data?.data

  if (all.isError || assigned.isError) {
    return <p className="mt-2 text-sm text-destructive">{t('vendorProperties.loadError')}</p>
  }
  if (all.isPending || assigned.isPending || !assignedData) {
    return <p className="mt-2 text-sm text-muted-foreground">{t('vendorProperties.loading')}</p>
  }

  const serverIds = new Set(assignedData.map((p) => p.id))
  const selected = draft ?? serverIds

  const properties = all.data.data
  if (properties.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">{t('vendorProperties.noneExist')}</p>
  }

  const toggle = (id: string) =>
    setDraft((prev) => {
      const next = new Set(prev ?? serverIds)
      if (!next.delete(id)) next.add(id)
      return next
    })

  // After a save the refetched server set matches the draft, so this goes false
  // on its own — no need to clear the draft.
  const dirty = serverIds.size !== selected.size || [...selected].some((id) => !serverIds.has(id))

  const saveError = save.error instanceof ApiError ? save.error.message : null

  return (
    <div className="mt-2">
      <ul className="space-y-1">
        {properties.map((p) => (
          <li key={p.id}>
            {/* The whole row is the label, so the tap target is the full width
                rather than the 16px box — this list gets used on a phone. */}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span className="text-sm text-foreground">{propertyLabel(p)}</span>
            </label>
          </li>
        ))}
      </ul>

      {selected.size === 0 && (
        <p className="mt-2 text-xs text-status-overdue-foreground">
          {t('vendorProperties.noneSelectedWarning')}
        </p>
      )}
      {saveError && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate([...selected])}
        >
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
        {!dirty && !save.isPending && (
          <span className="text-xs text-muted-foreground">{t('vendorProperties.upToDate')}</span>
        )}
      </div>
    </div>
  )
}
