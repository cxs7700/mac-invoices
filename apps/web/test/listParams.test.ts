import { describe, it, expect } from 'vitest'
import {
  parseListParams,
  toSearchParams,
  toQueryParams,
  rangeStart,
  hasActiveFilters,
} from '@/lib/listParams'

const parse = (qs: string) => parseListParams(new URLSearchParams(qs))

describe('date range presets', () => {
  it('derives each preset start from the given day', () => {
    const today = new Date(2026, 6, 15) // 2026-07-15, local time
    expect(rangeStart('1w', today)).toBe('2026-07-08')
    expect(rangeStart('1m', today)).toBe('2026-06-15')
    expect(rangeStart('3m', today)).toBe('2026-04-15')
    expect(rangeStart('6m', today)).toBe('2026-01-15')
    expect(rangeStart('ytd', today)).toBe('2026-01-01')
    expect(rangeStart('1y', today)).toBe('2025-07-15')
  })

  it('clamps month arithmetic instead of overflowing into the next month', () => {
    // Mar 31 − 1 month is Feb 28/29, never Mar 2/3.
    expect(rangeStart('1m', new Date(2026, 2, 31))).toBe('2026-02-28')
    expect(rangeStart('1m', new Date(2024, 2, 31))).toBe('2024-02-29')
  })

  it('leaves the window open-ended so future-dated invoices stay visible', () => {
    const q = toQueryParams(parse('range=1m'))
    expect(q.from).toBeDefined()
    expect(q.to).toBeUndefined()
  })
})

describe('parseListParams', () => {
  it('keeps a known preset and ignores any dates riding along with it', () => {
    const f = parse('range=3m&from=2020-01-01&to=2020-02-01')
    expect(f).toMatchObject({ range: '3m', from: '', to: '' })
  })

  it('reads dates only in the custom range', () => {
    expect(parse('range=custom&from=2026-01-01&to=2026-02-01')).toMatchObject({
      range: 'custom',
      from: '2026-01-01',
      to: '2026-02-01',
    })
  })

  it('treats a bare from/to (older bookmark) as the custom range', () => {
    expect(parse('from=2026-01-01')).toMatchObject({ range: 'custom', from: '2026-01-01', to: '' })
  })

  it('drops a garbage range and garbage dates', () => {
    expect(parse('range=__bad__')).toMatchObject({ range: '', from: '', to: '' })
    expect(parse('from=xyz')).toMatchObject({ range: '', from: '', to: '' })
  })
})

describe('toSearchParams', () => {
  it('round-trips a preset without writing derived dates', () => {
    expect(toSearchParams(parse('range=6m')).toString()).toBe('range=6m')
  })

  it('writes the dates for a custom range', () => {
    const sp = toSearchParams(parse('range=custom&from=2026-01-01&to=2026-02-01'))
    expect(sp.get('range')).toBe('custom')
    expect(sp.get('from')).toBe('2026-01-01')
    expect(sp.get('to')).toBe('2026-02-01')
  })
})

describe('hasActiveFilters', () => {
  it('counts a preset as an active filter', () => {
    expect(hasActiveFilters(parse('range=1y'))).toBe(true)
    expect(hasActiveFilters(parse(''))).toBe(false)
  })
})
