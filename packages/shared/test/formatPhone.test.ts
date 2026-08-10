import { describe, it, expect } from 'vitest'
import { formatPhone } from '../src/lib/formatPhone'

describe('formatPhone', () => {
  it('formats a bare 10-digit number', () => {
    expect(formatPhone('1234567890')).toBe('(123)456-7890')
  })

  it('reformats numbers however they were punctuated', () => {
    expect(formatPhone('123-456-7890')).toBe('(123)456-7890')
    expect(formatPhone('(123) 456 7890')).toBe('(123)456-7890')
    expect(formatPhone(' 123.456.7890 ')).toBe('(123)456-7890')
  })

  it('drops a US country code', () => {
    expect(formatPhone('11234567890')).toBe('(123)456-7890')
    expect(formatPhone('+1 (123) 456-7890')).toBe('(123)456-7890')
  })

  it('leaves a number it cannot confidently reformat alone', () => {
    // Too short / too long to be a NANP number.
    expect(formatPhone('555-1234')).toBe('555-1234')
    expect(formatPhone('123456789012')).toBe('123456789012')
    // International: the leading digits are not a US area code to reshape.
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    // An extension would be truncated by a naive 10-digit match.
    expect(formatPhone('123-456-7890 x22')).toBe('123-456-7890 x22')
  })

  it('handles empty and nullish input', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
  })
})
