import { describe, it, expect, afterEach } from 'vitest'
import i18n from '@/lib/i18n'
import { formatMoney, formatDate } from '@/lib/format'

afterEach(() => i18n.changeLanguage('en'))

describe('i18n foundation', () => {
  it('resolves synchronously (both locales bundled) with en as the default', () => {
    expect(i18n.language).toBe('en')
    expect(i18n.t('nav.dashboard')).toBe('Dashboard')
  })

  it('switches a translated key to its Cantonese value and back', async () => {
    await i18n.changeLanguage('zh')
    expect(i18n.t('nav.dashboard')).toBe('總覽')
    expect(i18n.t('nav.invoices')).toBe('發票')
    await i18n.changeLanguage('en')
    expect(i18n.t('nav.dashboard')).toBe('Dashboard')
  })

  it('localizes Intl by active locale but keeps currency USD', async () => {
    expect(formatMoney('1234.50')).toBe('$1,234.50')
    expect(formatDate('2026-01-15')).toBe('Jan 15, 2026')

    await i18n.changeLanguage('zh')
    // Currency symbol stays USD; the date renders in the zh format.
    expect(formatMoney('1234.50')).toContain('$')
    expect(formatDate('2026-01-15')).toContain('2026')
    expect(formatDate('2026-01-15')).not.toBe('Jan 15, 2026')
  })
})
