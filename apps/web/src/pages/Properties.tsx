import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { propertyLabel } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { useProperties, useCreateProperty, useDeleteProperty } from '@/hooks/useProperties'

export default function Properties() {
  const { t } = useTranslation()
  const { data, isPending, isError } = useProperties()
  const create = useCreateProperty()
  const del = useDeleteProperty()

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  // propertyId -> delete-guard error (e.g. "3 invoices assigned").
  const [delErrors, setDelErrors] = useState<Record<string, string>>({})

  const createError = create.error instanceof ApiError ? create.error.message : null

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault()
    create.mutate(
      { name: name.trim() || undefined, address: address.trim(), notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setName('')
          setAddress('')
          setNotes('')
        },
      },
    )
  }

  const onDelete = (id: string) =>
    del.mutate(id, {
      onError: (err) =>
        setDelErrors((m) => ({
          ...m,
          [id]: err instanceof ApiError ? err.message : t('properties.deleteFailed'),
        })),
    })

  const properties = data?.data ?? []

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-foreground">{t('properties.title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('properties.subtitle')}</p>

      <form onSubmit={onCreate} className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              {t('properties.nameOptional')}
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('properties.namePlaceholder')}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="address" className="text-sm font-medium text-foreground">
              {t('properties.address')}
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
            {t('properties.notesOptional')}
          </label>
          <input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        {createError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {createError}
          </p>
        )}
        <Button type="submit" className="mt-3" disabled={create.isPending || !address.trim()}>
          {create.isPending ? t('properties.adding') : t('properties.addProperty')}
        </Button>
      </form>

      {isError ? (
        <p className="text-sm text-destructive">{t('properties.loadError')}</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">{t('properties.loading')}</p>
      ) : properties.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('properties.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {properties.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/properties/${p.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {propertyLabel(p)}
                  </Link>
                  {p.name.trim() && (
                    <p className="truncate text-sm text-muted-foreground">{p.address}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <Link
                    to={`/properties/${p.id}/edit`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t('properties.edit')}
                  </Link>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id)}
                    disabled={del.isPending}
                    className="text-destructive hover:underline"
                  >
                    {t('properties.delete')}
                  </button>
                </div>
              </div>
              {delErrors[p.id] && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {delErrors[p.id]}{' '}
                  <Link to={`/invoices?propertyId=${p.id}`} className="underline">
                    {t('properties.viewItsInvoices')}
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
