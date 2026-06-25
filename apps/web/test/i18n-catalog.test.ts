import { describe, it, expect } from 'vitest'
import en from '@/locales/en/translation.json'
import zh from '@/locales/zh/translation.json'

// Guardrail (stands in for the deferred i18next-cli type-gen): the two locale
// catalogs must have an identical key structure. A key present in one but not the
// other is a silent gap — the missing locale falls back to the other language.
function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe('i18n catalogs', () => {
  it('EN and ZH have identical key sets', () => {
    const enKeys = keyPaths(en).sort()
    const zhKeys = keyPaths(zh).sort()
    const onlyEn = enKeys.filter((k) => !zhKeys.includes(k))
    const onlyZh = zhKeys.filter((k) => !enKeys.includes(k))
    expect({ onlyEn, onlyZh }).toEqual({ onlyEn: [], onlyZh: [] })
  })

  it('no translation value is empty', () => {
    const empties = keyPaths(en).filter((k) => {
      const val = k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], en)
      return typeof val === 'string' && val.trim() === ''
    })
    expect(empties).toEqual([])
  })
})
