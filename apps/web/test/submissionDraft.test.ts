import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadDraft, saveDraft, clearDraft, isEmptyDraft } from '@/lib/submissionDraft'
import type { DraftFields } from '@/lib/submissionDraft'

const TOKEN = 'inv_abc_def_secret'

const fields = (over: Partial<DraftFields> = {}): DraftFields => ({
  items: [{ id: 'i1', description: 'Fixed a leak', quantity: '1', total: '120' }],
  invoiceDate: '2026-06-01',
  notes: 'Gate code 1234',
  partsOrdered: '',
  category: '',
  propertyId: 'p1',
  photos: [{ url: 'https://blob.example/owners/c/p.jpg', type: 'CASH' }],
  ...over,
})

const empty = (): DraftFields => ({
  items: [{ id: 'i1', description: '', quantity: '1', total: '' }],
  invoiceDate: '',
  notes: '',
  partsOrdered: '',
  category: '',
  propertyId: '',
  photos: [],
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('submissionDraft', () => {
  it('round-trips a draft for its own link', () => {
    saveDraft(TOKEN, fields())
    expect(loadDraft(TOKEN)).toEqual(fields())
  })

  it('keeps one vendor link’s draft out of another’s', () => {
    saveDraft(TOKEN, fields())
    expect(loadDraft('inv_a_different_link')).toBeNull()
  })

  it('never writes the link token itself into storage', () => {
    saveDraft(TOKEN, fields())
    // The token is the vendor's credential. It is already on the device in the
    // URL, but the storage key must not spread it further.
    const everything = Object.keys(localStorage).join('|') + JSON.stringify(localStorage)
    expect(everything).not.toContain(TOKEN)
  })

  it('clears rather than stores a form with nothing in it', () => {
    saveDraft(TOKEN, fields())
    saveDraft(TOKEN, empty())
    expect(loadDraft(TOKEN)).toBeNull()
    expect(Object.keys(localStorage)).toHaveLength(0)
  })

  it('drops a draft older than a week, and removes it', () => {
    const eightDays = 8 * 24 * 60 * 60 * 1000
    saveDraft(TOKEN, fields(), 1_000_000)
    expect(loadDraft(TOKEN, 1_000_000 + eightDays)).toBeNull()
    expect(Object.keys(localStorage)).toHaveLength(0)
  })

  it('still restores a draft from within the week', () => {
    const sixDays = 6 * 24 * 60 * 60 * 1000
    saveDraft(TOKEN, fields(), 1_000_000)
    expect(loadDraft(TOKEN, 1_000_000 + sixDays)).toEqual(fields())
  })

  it('discards a draft whose shape no longer matches, instead of crashing', () => {
    saveDraft(TOKEN, fields())
    // Simulate a deploy that changed the shape: photos gain a required field,
    // or items lose one. A vendor standing in a driveway must not meet a crash.
    const key = Object.keys(localStorage)[0]
    localStorage.setItem(key, JSON.stringify({ items: 'not an array', savedAt: Date.now() }))
    expect(loadDraft(TOKEN)).toBeNull()
    expect(Object.keys(localStorage)).toHaveLength(0)
  })

  it('discards unparseable storage', () => {
    saveDraft(TOKEN, fields())
    localStorage.setItem(Object.keys(localStorage)[0], '{ not json')
    expect(loadDraft(TOKEN)).toBeNull()
  })

  it('returns null rather than throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    expect(loadDraft(TOKEN)).toBeNull()
  })

  it('swallows a failed write so the form still works this visit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    // Private mode: saving is best-effort, never fatal.
    expect(() => saveDraft(TOKEN, fields())).not.toThrow()
  })

  it('clearDraft removes only that link’s draft', () => {
    saveDraft(TOKEN, fields())
    saveDraft('other_link', fields())
    clearDraft(TOKEN)
    expect(loadDraft(TOKEN)).toBeNull()
    expect(loadDraft('other_link')).not.toBeNull()
  })
})

describe('isEmptyDraft', () => {
  it('treats a pristine form as empty', () => {
    expect(isEmptyDraft(empty())).toBe(true)
  })

  it.each([
    ['a typed description', { items: [{ id: 'i1', description: 'x', quantity: '1', total: '' }] }],
    ['a typed total', { items: [{ id: 'i1', description: '', quantity: '1', total: '10' }] }],
    ['a date', { invoiceDate: '2026-06-01' }],
    ['a property', { propertyId: 'p1' }],
    ['a photo', { photos: [{ url: 'u', type: 'OTHER' as const }] }],
    ['notes', { notes: 'gate code' }],
  ])('treats %s as worth keeping', (_label, over) => {
    expect(isEmptyDraft({ ...empty(), ...over })).toBe(false)
  })

  it('does not count whitespace as content', () => {
    expect(isEmptyDraft({ ...empty(), notes: '   ', partsOrdered: '\n' })).toBe(true)
  })
})
