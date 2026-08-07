import { describe, it, expect } from 'vitest'
import { summarizeItems } from '../src/index'

describe('summarizeItems', () => {
  it('returns the single description as-is for one item', () => {
    expect(summarizeItems([{ description: 'Ceiling drywall' }])).toBe('Ceiling drywall')
  })

  it('joins multiple descriptions under the cap', () => {
    expect(summarizeItems([{ description: 'Paint' }, { description: 'Ceiling drywall' }])).toBe(
      'Paint, Ceiling drywall',
    )
  })

  it('collapses beyond the cap into a "+N more" suffix', () => {
    const items = ['A', 'B', 'C', 'D', 'E'].map((description) => ({ description }))
    expect(summarizeItems(items, 3)).toBe('A, B, C +2 more')
  })

  it('orders by sortOrder when present, regardless of input order', () => {
    const items = [
      { description: 'Second', sortOrder: 1 },
      { description: 'First', sortOrder: 0 },
    ]
    expect(summarizeItems(items)).toBe('First, Second')
  })

  it('does not throw on an empty array', () => {
    expect(summarizeItems([])).toBe('')
  })
})
