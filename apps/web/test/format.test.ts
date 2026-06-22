import { describe, it, expect } from 'vitest'
import { formatMoney, formatDate } from '@/lib/format'

describe('formatMoney', () => {
  it('formats a string amount (no float math on the value)', () => {
    expect(formatMoney('149.99')).toBe('$149.99')
    expect(formatMoney('1253.25')).toBe('$1,253.25')
  })

  it('handles a non-numeric value gracefully', () => {
    expect(formatMoney('not-a-number')).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats an ISO date', () => {
    expect(formatDate('2026-01-15')).toMatch(/Jan 15, 2026/)
  })

  it('returns a dash for null/invalid', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('garbage')).toBe('—')
  })
})
