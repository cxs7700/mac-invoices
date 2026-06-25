import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AppShell } from '@/components/AppShell'

vi.mock('@/hooks/useAuth', () => ({
  useMe: () => ({ data: { email: 'l@example.com', name: null } }),
  useLogout: () => ({ mutate: vi.fn() }),
}))

// The bell mounts in the shell header; stub its data hooks so this drawer test
// needs no QueryClientProvider.
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ data: { data: [], unreadCount: 0 } }),
  useMarkNotificationsSeen: () => ({ mutate: vi.fn() }),
}))

const renderShell = () =>
  render(
    <MemoryRouter>
      <AppShell>
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  )

describe('AppShell mobile drawer', () => {
  it('opens and closes the nav drawer', () => {
    renderShell()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByLabelText('Open menu'))
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.click(screen.getByLabelText('Close menu'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the drawer when a nav link is clicked', () => {
    renderShell()
    fireEvent.click(screen.getByLabelText('Open menu'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Invoices'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
