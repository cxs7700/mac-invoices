import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/StatusBadge'

const past = '2020-01-01'
const future = '2999-01-01'

describe('StatusBadge', () => {
  it('renders Paid for PAID', () => {
    render(<StatusBadge status="PAID" />)
    expect(screen.getByText('Paid')).toBeDefined()
  })

  it('derives Overdue for an unpaid invoice past its due date', () => {
    render(<StatusBadge status="PENDING" dueDate={past} />)
    expect(screen.getByText('Overdue')).toBeDefined()
  })

  it('shows Pending when not past due / no due date', () => {
    render(<StatusBadge status="PENDING" dueDate={future} />)
    expect(screen.getByText('Pending')).toBeDefined()
  })

  it('renders REJECTED / CANCELLED labels', () => {
    render(<StatusBadge status="REJECTED" />)
    expect(screen.getByText('Rejected')).toBeDefined()
  })

  it('always carries an accessible label', () => {
    render(<StatusBadge status="PAID" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Status: Paid')
  })
})
