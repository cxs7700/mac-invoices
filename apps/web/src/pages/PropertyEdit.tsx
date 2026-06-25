import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { useProperty, useUpdateProperty } from '@/hooks/useProperties'

export default function PropertyEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: property, isPending, isError } = useProperty(id!)
  const update = useUpdateProperty(id!)

  if (isPending) return <div className="text-muted-foreground">Loading…</div>
  if (isError || !property)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Property not found.</p>
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/properties">Back to properties</Link>
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
  const [name, setName] = useState(initial.name)
  const [address, setAddress] = useState(initial.address)
  const [notes, setNotes] = useState(initial.notes ?? '')
  const serverError = update.error instanceof ApiError ? update.error.message : null

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    update.mutate(
      { name: name.trim(), address: address.trim(), notes: notes.trim() || undefined },
      { onSuccess: onSaved },
    )
  }

  return (
    <div className="max-w-2xl">
      <Link to="/properties" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to properties
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-foreground">Edit property</h1>

      <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              Name
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
              Address
            </label>
            <input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="notes" className="text-sm font-medium text-foreground">
            Notes (optional)
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
        <Button type="submit" className="mt-3" disabled={update.isPending || !name.trim() || !address.trim()}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </div>
  )
}
