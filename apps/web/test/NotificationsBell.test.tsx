import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { NotificationsBell } from '@/components/NotificationsBell'

const { useNotifications, useMarkNotificationsSeen } = vi.hoisted(() => ({
  useNotifications: vi.fn(),
  useMarkNotificationsSeen: vi.fn(),
}))
vi.mock('@/hooks/useNotifications', () => ({ useNotifications, useMarkNotificationsSeen }))

const markSeen = vi.fn()
const item = (over = {}) => ({
  id: 'e1',
  type: 'CREATED',
  vendorName: 'Joe',
  invoiceId: 'inv_1',
  summary: 'submitted an invoice',
  createdAt: '2026-06-25T00:00:00.000Z',
  unread: true,
  ...over,
})

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationsBell />
    </MemoryRouter>,
  )
}

describe('NotificationsBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMarkNotificationsSeen.mockReturnValue({ mutate: markSeen })
  })

  it('shows an unread badge when there are unread items', () => {
    useNotifications.mockReturnValue({ data: { data: [item()], unreadCount: 3 } })
    renderBell()
    expect(screen.getByTestId('unread-badge').textContent).toBe('3')
    expect(screen.getByRole('button', { name: /3 unread/i })).toBeDefined()
  })

  it('shows no badge when nothing is unread', () => {
    useNotifications.mockReturnValue({ data: { data: [item({ unread: false })], unreadCount: 0 } })
    renderBell()
    expect(screen.queryByTestId('unread-badge')).toBeNull()
  })

  it('opening the panel marks the feed seen and reveals items linking to the invoice', () => {
    useNotifications.mockReturnValue({ data: { data: [item()], unreadCount: 1 } })
    renderBell()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(markSeen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('submitted an invoice')).toBeDefined()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/invoices/inv_1')
  })

  it('does not mark seen when there is nothing unread', () => {
    useNotifications.mockReturnValue({ data: { data: [], unreadCount: 0 } })
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(markSeen).not.toHaveBeenCalled()
    expect(screen.getByText(/no vendor activity yet/i)).toBeDefined()
  })
})
