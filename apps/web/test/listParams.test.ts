import { describe, it, expect } from 'vitest'
import {
  parseListParams,
  toSearchParams,
  toQueryParams,
  rangeStart,
  resolvedDates,
  hasActiveFilters,
  taxYear,
  taxYearOptions,
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

  it('counts a tax year as an active filter', () => {
    expect(hasActiveFilters(parse('range=ty2025'))).toBe(true)
  })
})

describe('tax-year ranges', () => {
  it('resolves to the whole calendar year, closed on both ends', () => {
    // Unlike the lookback presets, which leave `to` open because they mean
    // "since X", a tax year is bounded at both ends.
    expect(resolvedDates(parse('range=ty2025'))).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    })
  })

  it('does not depend on today, unlike a lookback preset', () => {
    const a = resolvedDates(parse('range=ty2023'), new Date(2026, 0, 15))
    const b = resolvedDates(parse('range=ty2023'), new Date(2030, 6, 1))
    expect(a).toEqual(b)
  })

  it('survives the URL round-trip without writing derived dates', () => {
    expect(toSearchParams(parse('range=ty2024')).toString()).toBe('range=ty2024')
  })

  it('reaches the API as a concrete closed window', () => {
    const q = toQueryParams(parse('range=ty2022'))
    expect(q.from).toBe('2022-01-01')
    expect(q.to).toBe('2022-12-31')
  })

  it('accepts a year outside the offered list, so an old bookmark still works', () => {
    expect(taxYear('ty2019')).toBe(2019)
    expect(parse('range=ty2019').range).toBe('ty2019')
  })

  it('rejects implausible or malformed years', () => {
    expect(taxYear('ty1999')).toBeNull()
    expect(taxYear('ty2101')).toBeNull()
    expect(taxYear('ty25')).toBeNull()
    expect(taxYear('tyabcd')).toBeNull()
    expect(taxYear('1y')).toBeNull()
    expect(parse('range=ty1999')).toMatchObject({ range: '', from: '', to: '' })
  })

  it('offers completed years only, newest first — never the current one', () => {
    const years = taxYearOptions(new Date(2026, 7, 23))
    expect(years).toEqual([2025, 2024, 2023, 2022, 2021])
    expect(years).not.toContain(2026)
  })
})
