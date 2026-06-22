import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FilterBar } from '@/components/FilterBar'
import type { ListFilters } from '@/lib/listParams'

const base: ListFilters = {
  status: '',
  from: '',
  to: '',
  vendor: '',
  sort: 'invoiceDate',
  order: 'desc',
  page: 1,
}

afterEach(() => vi.useRealTimers())

describe('FilterBar', () => {
  it('calls onChange immediately when status changes', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={base} onChange={onChange} onClear={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'PAID' } })
    expect(onChange).toHaveBeenCalledWith({ status: 'PAID' })
  })

  it('debounces the vendor input into a single onChange', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<FilterBar filters={base} onChange={onChange} onClear={vi.fn()} />)
    const input = screen.getByLabelText('Filter by vendor')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'ac' } })
    fireEvent.change(input, { target: { value: 'acme' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ vendor: 'acme' })
  })

  it('toggles sort order with a state-reflecting aria-label', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={base} onChange={onChange} onClear={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Sort descending'))
    expect(onChange).toHaveBeenCalledWith({ order: 'asc' })
  })

  it('shows Clear filters only when a filter is active', () => {
    const { rerender } = render(<FilterBar filters={base} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByText('Clear filters')).toBeNull()
    rerender(<FilterBar filters={{ ...base, status: 'PAID' }} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByText('Clear filters')).toBeDefined()
  })

  it('warns when the from date is after the to date', () => {
    render(
      <FilterBar
        filters={{ ...base, from: '2026-03-01', to: '2026-01-01' }}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/start date must be on or before/i)
  })
})
