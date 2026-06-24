import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewActions } from '@/components/ReviewActions'

// U12 — the two review flows the API enforces by 422 must be enforced in the UI
// by construction: Approve requires a category before it can fire; Reject
// requires a non-empty reason.
describe('ReviewActions', () => {
  it('approve requires a category before firing, then sends it', () => {
    const onApprove = vi.fn()
    render(<ReviewActions onApprove={onApprove} onReject={vi.fn()} isPending={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const confirm = screen.getByRole('button', { name: /confirm approve/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // no category yet
    fireEvent.change(screen.getByLabelText(/set a category/i), { target: { value: 'LABOR' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onApprove).toHaveBeenCalledWith('LABOR')
  })

  it('reject requires a non-empty reason, then sends it', () => {
    const onReject = vi.fn()
    render(<ReviewActions onApprove={vi.fn()} onReject={onReject} isPending={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: /confirm reject/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // no reason yet
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Wrong amount' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onReject).toHaveBeenCalledWith('Wrong amount')
  })

  it('cancel returns to the idle approve/reject choice', () => {
    render(<ReviewActions onApprove={vi.fn()} onReject={vi.fn()} isPending={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined()
  })
})
