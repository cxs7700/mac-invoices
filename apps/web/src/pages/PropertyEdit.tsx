import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { useProperty, useUpdateProperty } from '@/hooks/useProperties'

export default function PropertyEdit() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: property, isPending, isError } = useProperty(id!)
  const update = useUpdateProperty(id!)

  if (isPending) return <div className="text-muted-foreground">{t('propertyEdit.loading')}</div>
  if (isError || !property)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">{t('propertyEdit.notFound')}</p>
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/properties">{t('propertyEdit.backToProperties')}</Link>
        </Button>
      </div>
    )

  return <EditForm id={id!} initial={property} onSaved={() => navigate('/properties')} update={update} />
}

function EditForm({
  initial,
  onSaved,
  update,
}: {
  id: string
  initial: { name: string; address: string; notes: string | null }
  onSaved: () => void
  update: ReturnType<typeof useUpdateProperty>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial.name)
  const [address, setAddress] = useState(initial.address)
  const [notes, setNotes] = useState(initial.notes ?? '')
  const serverError = update.error instanceof ApiError ? update.error.message : null

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    update.mutate(
      // Send name even when empty so clearing it removes the label (server stores '').
      { name: name.trim(), address: address.trim(), notes: notes.trim() || undefined },
      { onSuccess: onSaved },
    )
  }

  return (
    <div className="max-w-2xl">
      <Link to="/properties" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t('propertyEdit.backToProperties')}
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-foreground">{t('propertyEdit.title')}</h1>

      <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              {t('propertyEdit.nameOptional')}
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="address" className="text-sm font-medium text-foreground">
              {t('propertyEdit.address')}
            </label>
            <AddressAutocomplete
              id="address"
              value={address}
              onChange={setAddress}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="notes" className="text-sm font-medium text-foreground">
            {t('propertyEdit.notesOptional')}
          </label>
          <input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        {serverError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {serverError}
          </p>
        )}
        <Button type="submit" className="mt-3" disabled={update.isPending || !address.trim()}>
          {update.isPending ? t('propertyEdit.saving') : t('propertyEdit.saveChanges')}
        </Button>
      </form>
    </div>
  )
}
