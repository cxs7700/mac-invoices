import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the provider SDK so listAllBlobs' pagination is testable without live Blob.
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@vercel/blob', () => ({ list, del: vi.fn(), getDownloadUrl: vi.fn() }))
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: vi.fn() }))

import { listAllBlobs } from '../src/integrations/storage'

const blob = (pathname: string) => ({
  url: `https://blob/${pathname}`,
  pathname,
  uploadedAt: new Date('2026-06-01'),
})

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
  list.mockReset()
})

describe('listAllBlobs pagination', () => {
  it('walks every page via the cursor and returns each blob once', async () => {
    list
      .mockResolvedValueOnce({ blobs: [blob('owners/u/a')], hasMore: true, cursor: 'c1' })
      .mockResolvedValueOnce({ blobs: [blob('owners/u/b')], hasMore: false, cursor: undefined })
    const blobs = await listAllBlobs()
    expect(blobs.map((b) => b.pathname)).toEqual(['owners/u/a', 'owners/u/b'])
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1][0].cursor).toBe('c1') // second page used the returned cursor
  })

  it('terminates if hasMore is true but no cursor is returned (no infinite loop)', async () => {
    list.mockResolvedValue({ blobs: [blob('owners/u/x')], hasMore: true, cursor: undefined })
    const blobs = await listAllBlobs()
    expect(blobs).toHaveLength(1)
    expect(list).toHaveBeenCalledTimes(1) // stopped instead of looping forever
  })

  it('throws a sanitized error when the token is unset', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    await expect(listAllBlobs()).rejects.toMatchObject({ statusCode: 503 })
  })
})
