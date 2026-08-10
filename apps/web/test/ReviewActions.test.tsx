import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ReviewActions } from '@/components/ReviewActions'

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => ({
    data: {
      data: [{ id: 'p1', name: 'Maple', address: 'A', notes: null, createdAt: '2026-06-01' }],
    },
    isPending: false,
    isError: false,
  }),
}))

const renderActions = (props: Parameters<typeof ReviewActions>[0]) =>
  render(
    <MemoryRouter>
      <ReviewActions {...props} />
    </MemoryRouter>,
  )

// U12 — the two review flows the API enforces by 422 must be enforced in the UI
// by construction: Approve requires a category AND a property before it can fire;
// Reject requires a non-empty reason.
describe('ReviewActions', () => {
  it('approve requires a category and a property before firing, then sends both', () => {
    const onApprove = vi.fn()
    renderActions({ onApprove, onReject: vi.fn(), isPending: false })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const confirm = screen.getByRole('button', { name: /confirm approve/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // nothing set yet
    fireEvent.change(screen.getByLabelText(/set a category/i), { target: { value: 'LABOR' } })
    expect(confirm.disabled).toBe(true) // still need a property
    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'p1' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onApprove).toHaveBeenCalledWith('LABOR', 'p1')
  })

  it('reject requires a non-empty reason, then sends it', () => {
    const onReject = vi.fn()
    renderActions({ onApprove: vi.fn(), onReject, isPending: false })

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: /confirm reject/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // no reason yet
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Wrong amount' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onReject).toHaveBeenCalledWith('Wrong amount')
  })

  it('cancel returns to the idle approve/reject choice', () => {
    renderActions({ onApprove: vi.fn(), onReject: vi.fn(), isPending: false })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined()
  })
})
