import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send } })) }))

import { sendEmail } from '../../src/integrations/email'

const MSG = { to: 'l@example.com', subject: 'Digest', html: '<p>hi</p>' }
const API_KEY = 're_test_SECRET_KEY'

describe('email integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = API_KEY
    process.env.EMAIL_FROM = 'onboarding@resend.dev'
    process.env.EMAIL_RETRY_BASE_MS = '1'
  })
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
  })

  it('throws EMAIL_NOT_CONFIGURED (503) and never calls the provider when the key is unset', async () => {
    delete process.env.RESEND_API_KEY
    await expect(sendEmail(MSG)).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED', statusCode: 503 })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends on the happy path', async () => {
    send.mockResolvedValue({ data: { id: '1' }, error: null })
    await expect(sendEmail(MSG)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'onboarding@resend.dev', to: MSG.to }))
  })

  it('maps a provider error to a sanitized AppError with no key/raw leak', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'invalid recipient', statusCode: 422 } })
    const err = await sendEmail(MSG).catch((e) => e)
    expect(err.code).toBe('EMAIL_ERROR')
    expect(err.statusCode).toBe(502)
    const dump = `${err.message} ${JSON.stringify(err)}`
    expect(dump).not.toContain(API_KEY)
    expect(dump).not.toContain('invalid recipient') // raw provider message not surfaced
  })

  it('retries a transient 5xx then succeeds', async () => {
    send
      .mockResolvedValueOnce({ data: null, error: { statusCode: 500 } })
      .mockResolvedValueOnce({ data: null, error: { statusCode: 503 } })
      .mockResolvedValue({ data: { id: '1' }, error: null })
    await expect(sendEmail(MSG)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('surfaces a sanitized error after exhausting retries', async () => {
    send.mockResolvedValue({ data: null, error: { statusCode: 429 } })
    await expect(sendEmail(MSG)).rejects.toMatchObject({ code: 'EMAIL_RATE_LIMITED', statusCode: 502 })
    expect(send).toHaveBeenCalledTimes(4) // MAX_ATTEMPTS
  })
})
