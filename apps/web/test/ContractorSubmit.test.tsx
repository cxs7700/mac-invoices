import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import ContractorSubmit from '@/pages/ContractorSubmit'
import { ApiError } from '@/lib/apiClient'

const { useSubmissionStatus, useSubmit, useWithdraw } = vi.hoisted(() => ({
  useSubmissionStatus: vi.fn(),
  useSubmit: vi.fn(),
  useWithdraw: vi.fn(),
}))
vi.mock('@/hooks/useSubmission', () => ({
  useSubmissionStatus,
  useSubmit,
  useWithdraw,
  uploadSubmissionPhoto: vi.fn(),
}))

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/submit/inv_abc_def']}>
      <Routes>
        <Route path="/submit/:token" element={<ContractorSubmit />} />
      </Routes>
    </MemoryRouter>,
  )

const submitMock = { mutate: vi.fn(), isPending: false, error: null as unknown }

describe('ContractorSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    submitMock.error = null
    useSubmit.mockReturnValue(submitMock)
    useWithdraw.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('shows a loading state while the token resolves', () => {
    useSubmissionStatus.mockReturnValue({ isPending: true })
    renderPage()
    expect(screen.getByText('Loading…')).toBeDefined()
  })

  it('shows a dead-link state and no form when the token is invalid', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: true, error: new ApiError('NOT_FOUND', 'x', 404) })
    renderPage()
    expect(screen.getByText('This link is no longer active')).toBeDefined()
    expect(screen.queryByLabelText('Amount')).toBeNull()
  })

  it('renders the submit form + empty state for a valid token with no submissions', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    expect(screen.getByLabelText('Amount')).toBeDefined()
    expect(screen.getByText(/no submissions yet/i)).toBeDefined()
    // Submit is disabled with no photo/values.
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders submissions with statuses and a resubmit affordance on rejected ones', () => {
    useSubmissionStatus.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        data: [
          { id: '1', status: 'SUBMITTED', amount: '100.00', description: 'a', invoiceDate: '2026-06-01', rejectionReason: null, createdAt: '2026-06-01' },
          { id: '2', status: 'REJECTED', amount: '50.00', description: 'b', invoiceDate: '2026-06-01', rejectionReason: 'Wrong amount', createdAt: '2026-06-01' },
        ],
      },
    })
    renderPage()
    expect(screen.getByText('Submitted')).toBeDefined()
    expect(screen.getByText('Rejected')).toBeDefined()
    expect(screen.getByText(/Rejected: Wrong amount/)).toBeDefined()
    expect(screen.getByRole('button', { name: /submit a new invoice to resubmit/i })).toBeDefined()
    // SUBMITTED rows offer withdraw.
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeDefined()
  })

  it('shows a distinct rate-limit message on a 429', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    submitMock.error = new ApiError('TOO_MANY_REQUESTS', 'Too many requests', 429)
    renderPage()
    expect(screen.getByText(/submitted too many times/i)).toBeDefined()
  })
})
