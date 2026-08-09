import { describe, it, expect } from 'vitest'
import { UpdateProfileSchema, SaveSheetSchema } from '../src/schemas/settings'

describe('UpdateProfileSchema', () => {
  it('accepts a trimmed first/last name', () => {
    const r = UpdateProfileSchema.safeParse({ firstName: '  Pat  ', lastName: ' Doe ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.firstName).toBe('Pat')
      expect(r.data.lastName).toBe('Doe')
    }
  })

  it('rejects an empty or over-long firstName', () => {
    expect(UpdateProfileSchema.safeParse({ firstName: '   ' }).success).toBe(false)
    expect(UpdateProfileSchema.safeParse({ firstName: 'a'.repeat(51) }).success).toBe(false)
  })

  it('rejects an over-long lastName but accepts an empty one (clears the field)', () => {
    expect(UpdateProfileSchema.safeParse({ lastName: 'a'.repeat(51) }).success).toBe(false)
    const r = UpdateProfileSchema.safeParse({ lastName: '   ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.lastName).toBe('')
  })

  it('accepts a partial body with only one field (PATCH contract)', () => {
    expect(UpdateProfileSchema.safeParse({ email: 'new@example.com' }).success).toBe(true)
    expect(UpdateProfileSchema.safeParse({ firstName: 'Pat' }).success).toBe(true)
    expect(UpdateProfileSchema.safeParse({ locale: 'zh' }).success).toBe(true)
  })

  it('rejects a malformed email', () => {
    expect(UpdateProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })
})

describe('SaveSheetSchema', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd'

  it('accepts a bare spreadsheet id', () => {
    expect(SaveSheetSchema.parse({ spreadsheetId: ID }).spreadsheetId).toBe(ID)
  })

  it('stores the bare id when given a full URL', () => {
    const parsed = SaveSheetSchema.parse({
      spreadsheetId: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
    })
    expect(parsed.spreadsheetId).toBe(ID)
  })

  it('rejects input that is not an id or a URL', () => {
    const result = SaveSheetSchema.safeParse({ spreadsheetId: 'my sheet' })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].message).toMatch(/Google Sheets ID or URL/)
  })

  it('rejects an empty value', () => {
    expect(SaveSheetSchema.safeParse({ spreadsheetId: '' }).success).toBe(false)
  })

  it('accepts a URL long enough that the old 200-char cap would have rejected it', () => {
    const long = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing&${'x'.repeat(180)}`
    expect(SaveSheetSchema.parse({ spreadsheetId: long }).spreadsheetId).toBe(ID)
  })
})
