import { useTranslation } from 'react-i18next'
import { ownerComplete, type OwnerDraft } from '@/lib/propertyOwner'

const inputClass = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

/**
 * The property-owner block shared by the create and edit forms. The owner is
 * the payee and the PDF's Bill-To — not necessarily the account holder, who
 * may be a property manager.
 */
export function PropertyOwnerFields({
  value,
  onChange,
}: {
  value: OwnerDraft
  onChange: (next: OwnerDraft) => void
}) {
  const { t } = useTranslation()
  const set = (key: keyof OwnerDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value })

  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold text-foreground">
        {t('propertyOwner.heading')}
      </legend>
      <p className="text-xs text-muted-foreground">{t('propertyOwner.help')}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ownerFirstName" className="text-sm font-medium text-foreground">
            {t('propertyOwner.firstName')}
          </label>
          <input
            id="ownerFirstName"
            value={value.firstName}
            onChange={set('firstName')}
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ownerLastName" className="text-sm font-medium text-foreground">
            {t('propertyOwner.lastName')}
          </label>
          <input
            id="ownerLastName"
            value={value.lastName}
            onChange={set('lastName')}
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ownerEmail" className="text-sm font-medium text-foreground">
            {t('propertyOwner.email')}
          </label>
          <input
            id="ownerEmail"
            type="email"
            value={value.email}
            onChange={set('email')}
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ownerPhone" className="text-sm font-medium text-foreground">
            {t('propertyOwner.phoneOptional')}
          </label>
          <input
            id="ownerPhone"
            type="tel"
            value={value.phone}
            onChange={set('phone')}
            autoComplete="off"
            className={inputClass}
          />
        </div>
      </div>
      {/* Saving is blocked until the owner is complete; say why rather than
          leave a silently greyed-out button. Matters most for properties
          created before owners existed, whose backfilled names may be blank. */}
      {!ownerComplete(value) && (
        <p className="mt-2 text-xs text-muted-foreground">{t('propertyOwner.required')}</p>
      )}
    </fieldset>
  )
}
