import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders Paid for PAID', () => {
    render(<StatusBadge status="PAID" />)
    expect(screen.getByText('Paid')).toBeDefined()
  })

  it('renders Pending for PENDING', () => {
    render(<StatusBadge status="PENDING" />)
    expect(screen.getByText('Pending')).toBeDefined()
  })

  it('renders REJECTED / CANCELLED labels', () => {
    render(<StatusBadge status="REJECTED" />)
    expect(screen.getByText('Rejected')).toBeDefined()
  })

  it('renders a distinct Submitted tone (not the pending fallback)', () => {
    render(<StatusBadge status="SUBMITTED" />)
    const badge = screen.getByText('Submitted')
    expect(badge.className).toContain('bg-status-submitted')
    expect(badge.className).not.toContain('bg-status-pending')
  })

  it('always carries an accessible label', () => {
    render(<StatusBadge status="PAID" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Status: Paid')
  })
})
