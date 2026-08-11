import { describe, it, expect } from 'vitest'
import { formatMoney, formatDate, syncState } from '@/lib/format'

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

describe('syncState', () => {
  it('is not-exported when never synced', () => {
    expect(syncState(null, '2026-06-01T00:00:00.000Z')).toBe('not-exported')
  })

  it('is exported when the row was last edited at or before the export', () => {
    // The mirror stamps sheetsSyncedAt to the instant the pass STARTED and no
    // longer touches updatedAt, so an untouched row's updatedAt sits at or
    // before the stamp.
    expect(syncState('2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')).toBe('exported')
    expect(syncState('2026-06-01T00:05:00.000Z', '2026-06-01T00:00:00.000Z')).toBe('exported')
  })

  it('is drifted when edited after the last export — with no tolerance window', () => {
    expect(syncState('2026-06-01T00:00:00.000Z', '2026-06-01T00:05:00.000Z')).toBe('drifted')
    // An edit moments after the export is still an edit: the sheet is stale.
    // This read 'exported' under the old 2s fudge.
    expect(syncState('2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.500Z')).toBe('drifted')
  })
})
