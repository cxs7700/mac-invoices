import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InvoiceTimeline } from '@/components/InvoiceTimeline'
import type { TimelineEvent } from '@/hooks/useInvoiceEvents'

const ev = (over: Partial<TimelineEvent>): TimelineEvent => ({
  id: Math.random().toString(36).slice(2),
  invoiceId: 'inv1',
  type: 'CREATED',
  source: 'RECORDED',
  detail: {},
  actor: { id: 'u1', name: 'Landlord' },
  createdAt: '2026-01-10T00:00:00.000Z',
  ...over,
})

describe('InvoiceTimeline', () => {
  it('renders created, a status transition, and a field edit with old → new', () => {
    render(
      <InvoiceTimeline
        events={[
          ev({ type: 'CREATED' }),
          ev({ type: 'STATUS_CHANGED', detail: { from: 'PENDING', to: 'APPROVED' } }),
          ev({ type: 'FIELD_EDITED', detail: { field: 'amount', old: '100.00', new: '250.00' } }),
        ]}
      />,
    )
    expect(screen.getByText('Created')).toBeDefined()
    expect(screen.getByText('Pending → Approved')).toBeDefined()
    expect(screen.getByText('Edited amount')).toBeDefined()
    expect(screen.getByText('100.00 → 250.00')).toBeDefined()
    expect(screen.getAllByText('by Landlord').length).toBeGreaterThan(0)
  })

  it('AE5: labels a reconstructed event as inferred; a recorded event is not', () => {
    const { rerender } = render(<InvoiceTimeline events={[ev({ source: 'RECONSTRUCTED' })]} />)
    expect(screen.getByText('inferred')).toBeDefined()

    rerender(<InvoiceTimeline events={[ev({ source: 'RECORDED' })]} />)
    expect(screen.queryByText('inferred')).toBeNull()
  })

  it('shows an empty state when there is no history', () => {
    render(<InvoiceTimeline events={[]} />)
    expect(screen.getByText('No recorded history yet.')).toBeDefined()
  })

  it('shows a loading state', () => {
    render(<InvoiceTimeline events={[]} isLoading />)
    expect(screen.getByText('Loading history…')).toBeDefined()
  })

  it('renders a deletion as a terminal event', () => {
    render(<InvoiceTimeline events={[ev({ type: 'DELETED', detail: { snapshot: {} } })]} />)
    expect(screen.getByText('Deleted')).toBeDefined()
  })

  it('labels image attach/remove events', () => {
    render(
      <InvoiceTimeline events={[ev({ type: 'IMAGE_ATTACHED' }), ev({ type: 'IMAGE_REMOVED' })]} />,
    )
    expect(screen.getByText('Photo attached')).toBeDefined()
    expect(screen.getByText('Photo removed')).toBeDefined()
  })
})
