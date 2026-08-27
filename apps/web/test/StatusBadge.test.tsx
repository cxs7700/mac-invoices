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

  it('gives all six statuses a distinct tone from the shared mapping', () => {
    const toneOf = (status: string) => {
      const { unmount } = render(<StatusBadge status={status} />)
      const className = screen.getByRole('status').className
      unmount()
      return /bg-tone-([a-z]+)\b/.exec(className)?.[1]
    }

    expect(toneOf('PENDING')).toBe('amber')
    expect(toneOf('SUBMITTED')).toBe('blue')
    expect(toneOf('PAID')).toBe('green')
    expect(toneOf('REJECTED')).toBe('red')
    expect(toneOf('CANCELLED')).toBe('slate')

    // The pill, the filter chips and the PDF all resolve through STATUS_TONE,
    // so this is the same colour a status gets everywhere else.
    const tones = ['PENDING', 'SUBMITTED', 'PAID', 'REJECTED', 'CANCELLED'].map(toneOf)
    expect(new Set(tones).size).toBe(5)
  })

  it('falls back to the quietest tone for an unknown status', () => {
    render(<StatusBadge status="NOT_A_STATUS" />)
    expect(screen.getByRole('status').className).toContain('bg-tone-slate')
  })

  it('always carries an accessible label', () => {
    render(<StatusBadge status="PAID" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Status: Paid')
  })
})
