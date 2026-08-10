import { describe, it, expect } from 'vitest'
import { normalizeSpreadsheetId } from '../src/lib/spreadsheetId'

// A realistic Google Drive file id: 44 URL-safe base64 characters.
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd'

describe('normalizeSpreadsheetId', () => {
  it('returns a bare id unchanged', () => {
    expect(normalizeSpreadsheetId(ID)).toBe(ID)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeSpreadsheetId(`  ${ID}\n`)).toBe(ID)
  })

  it('extracts the id from a full edit URL', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID)
  })

  it('extracts the id from a share URL', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(ID)
  })

  it('extracts the id from a URL with no scheme', () => {
    expect(normalizeSpreadsheetId(`docs.google.com/spreadsheets/d/${ID}`)).toBe(ID)
  })

  // The whole point of normalizing: these two inputs must collapse to one
  // value, or the unique index compares two strings and lets both through.
  it('collapses the URL and bare forms of one sheet to the same value', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBe(
      normalizeSpreadsheetId(ID),
    )
  })

  it('rejects free text', () => {
    expect(normalizeSpreadsheetId('my sheet')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(normalizeSpreadsheetId('')).toBeNull()
    expect(normalizeSpreadsheetId('   ')).toBeNull()
  })

  it('rejects something too short to be a Drive id', () => {
    expect(normalizeSpreadsheetId('abc')).toBeNull()
  })

  it('rejects an id containing characters Drive ids never use', () => {
    expect(normalizeSpreadsheetId(`${ID}!`)).toBeNull()
  })

  // A Docs/Slides URL has no /spreadsheets/d/ segment, so it falls through to
  // the bare-id rule and fails it (slashes are not valid id characters).
  it('rejects a Google Docs URL', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull()
  })

  it('rejects a spreadsheets URL whose id segment is too short', () => {
    expect(normalizeSpreadsheetId('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull()
  })

  // The URL Google's address bar shows for anyone signed into more than one
  // Google account — routine, not exotic.
  it('extracts the id from a multi-account URL (/u/0/d/)', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`)).toBe(ID)
  })

  it('extracts the id from a multi-account URL with a double-digit account index (/u/12/d/)', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/u/12/d/${ID}/edit`)).toBe(ID)
  })

  // A mangled/percent-encoded id must be rejected, not silently truncated to
  // a shorter prefix that happens to pass BARE_ID and gets stored as the
  // wrong value.
  it('rejects a mangled/percent-encoded id in a URL rather than truncating it', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}%2Fextra/edit`)).toBeNull()
  })
})
