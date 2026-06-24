import { useState } from 'react'
import { ApiError } from '@/lib/apiClient'
import { ContractorLinkCard } from '@/components/ContractorLinkCard'
import { Button } from '@/components/ui/button'
import {
  useContractors,
  useCreateContractor,
  useRevokeLink,
  useRegenerateLink,
} from '@/hooks/useContractors'

export default function Contractors() {
  const { data, isPending, isError } = useContractors()
  const create = useCreateContractor()
  const revoke = useRevokeLink()
  const regenerate = useRegenerateLink()

  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  // contractorId -> one-time plaintext link (only right after create/regenerate).
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  const createError = create.error instanceof ApiError ? create.error.message : null

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault()
    create.mutate(
      { name: name.trim(), contact: contact.trim() },
      {
        onSuccess: (c) => {
          setRevealed((r) => ({ ...r, [c.id]: c.link }))
          setName('')
          setContact('')
        },
      },
    )
  }
  const onRegenerate = (id: string) =>
    regenerate.mutate(id, { onSuccess: (c) => setRevealed((r) => ({ ...r, [c.id]: c.link })) })
  const dismiss = (id: string) =>
    setRevealed((r) => {
      const next = { ...r }
      delete next[id]
      return next
    })

  const busy = revoke.isPending || regenerate.isPending
  const contractors = data?.data ?? []

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-foreground">Contractors</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Add a contractor and share their link — they submit invoices from their phone, no login.
      </p>

      <form onSubmit={onCreate} className="mb-6 rounded-lg border border-border bg-card p-4">
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
            <label htmlFor="contact" className="text-sm font-medium text-foreground">
              Contact (phone or email)
            </label>
            <input
              id="contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        {createError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {createError}
          </p>
        )}
        <Button
          type="submit"
          className="mt-3"
          disabled={create.isPending || !name.trim() || !contact.trim()}
        >
          {create.isPending ? 'Adding…' : 'Add contractor'}
        </Button>
      </form>

      {isError ? (
        <p className="text-sm text-destructive">Couldn't load contractors.</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : contractors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contractors yet. Add one to get started.</p>
      ) : (
        <ul className="space-y-3">
          {contractors.map((c) => (
            <ContractorLinkCard
              key={c.id}
              contractor={c}
              revealedLink={revealed[c.id] ?? null}
              onDismissReveal={() => dismiss(c.id)}
              onRegenerate={() => onRegenerate(c.id)}
              onRevoke={() => revoke.mutate(c.id)}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
