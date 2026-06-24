import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Blob SDK — the adapter is the seam; no live storage calls.
const { del, getDownloadUrl, generateClientTokenFromReadWriteToken } = vi.hoisted(() => ({
  del: vi.fn(),
  getDownloadUrl: vi.fn(),
  generateClientTokenFromReadWriteToken: vi.fn(),
}))
vi.mock('@vercel/blob', () => ({ del, getDownloadUrl }))
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken }))

import {
  issueUploadToken,
  signedReadUrl,
  deleteBlob,
  ownerOf,
  isOwnedBy,
} from '../../src/integrations/storage'

describe('ownerOf / isOwnedBy (KTD-5 gate)', () => {
  it('parses the owner segment from a pathname or URL, null on mismatch', () => {
    expect(ownerOf('owners/u1/abc')).toBe('u1')
    expect(ownerOf('https://blob.example/owners/u1/abc?download=1')).toBe('u1')
    expect(ownerOf('elsewhere/u1/abc')).toBeNull()
    expect(isOwnedBy('owners/u1/abc', 'u1')).toBe(true)
    expect(isOwnedBy('owners/u2/abc', 'u1')).toBe(false)
  })
})

describe('storage not configured', () => {
  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    vi.clearAllMocks()
  })

  it('issueUploadToken (valid type) throws 503 when the token is unset', async () => {
    await expect(issueUploadToken('u1', 'image/png')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
      statusCode: 503,
    })
  })

  it('deleteBlob throws 503 when the token is unset', async () => {
    await expect(deleteBlob('owners/u1/x')).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
  })
})

describe('storage with token', () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_secret'
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects an unsupported content type with 415 (before any provider call)', async () => {
    await expect(issueUploadToken('u1', 'application/pdf')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      statusCode: 415,
    })
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled()
  })

  it('issues a token scoped to the owner prefix', async () => {
    generateClientTokenFromReadWriteToken.mockResolvedValue('client-token')
    const { token, pathname } = await issueUploadToken('u1', 'image/jpeg')
    expect(token).toBe('client-token')
    expect(pathname.startsWith('owners/u1/')).toBe(true)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledOnce()
  })

  it('sanitizes a provider error on delete — no raw error / token leak', async () => {
    del.mockRejectedValue(new Error('raw boom embedding vercel_blob_rw_secret'))
    await expect(deleteBlob('owners/u1/x')).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
      statusCode: 502,
    })
  })

  it('signedReadUrl delegates to the Blob download URL', () => {
    getDownloadUrl.mockReturnValue('https://signed/url')
    expect(signedReadUrl('owners/u1/x')).toBe('https://signed/url')
  })
})
