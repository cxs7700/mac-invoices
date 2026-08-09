import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AppShell } from '@/components/AppShell'

vi.mock('@/hooks/useAuth', () => ({
  useMe: () => ({ data: { email: 'l@example.com', name: null } }),
  useLogout: () => ({ mutate: vi.fn() }),
}))

// The bell + language switcher mount in the shell header; stub their data hooks
// so this drawer test needs no QueryClientProvider.
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ data: { data: [], unreadCount: 0 } }),
  useMarkNotificationsSeen: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useSettings', () => ({ useUpdateProfile: () => ({ mutate: vi.fn() }) }))

const renderShell = () =>
  render(
    <MemoryRouter>
      <AppShell>
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  )

describe('AppShell sidebar toggle', () => {
  beforeEach(() => localStorage.clear())

  it('hides and restores the sidebar', () => {
    renderShell()
    // The sidebar's own nav is present until hidden.
    expect(screen.getByLabelText('Hide sidebar')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Hide sidebar'))
    expect(screen.queryByLabelText('Hide sidebar')).toBeNull()

    fireEvent.click(screen.getByLabelText('Show sidebar'))
    expect(screen.getByLabelText('Hide sidebar')).toBeDefined()
  })

  it('remembers the choice across mounts', () => {
    const first = renderShell()
    fireEvent.click(screen.getByLabelText('Hide sidebar'))
    first.unmount()

    renderShell()
    expect(screen.getByLabelText('Show sidebar')).toBeDefined()
  })

  it('starts visible when nothing has been stored', () => {
    renderShell()
    expect(screen.getByLabelText('Hide sidebar')).toBeDefined()
  })
})

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
