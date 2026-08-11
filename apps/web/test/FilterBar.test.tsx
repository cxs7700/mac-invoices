import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FilterBar } from '@/components/FilterBar'
import type { ListFilters } from '@/lib/listParams'

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => ({ data: { data: [] }, isPending: false, isError: false }),
}))

const base: ListFilters = {
  status: '',
  range: '',
  from: '',
  to: '',
  vendor: '',
  search: '',
  propertyId: '',
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

  it('cancels a pending vendor debounce when filters change externally', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { rerender } = render(
      <FilterBar filters={{ ...base, status: 'PAID' }} onChange={onChange} onClear={vi.fn()} />,
    )
    fireEvent.change(screen.getByLabelText('Filter by vendor'), { target: { value: 'acme' } })
    // An external filter change (e.g. clear-all) lands before the 300ms fires.
    rerender(<FilterBar filters={base} onChange={onChange} onClear={vi.fn()} />)
    act(() => vi.advanceTimersByTime(300))
    // The just-typed-but-uncommitted vendor must NOT resurrect.
    expect(onChange).not.toHaveBeenCalledWith({ vendor: 'acme' })
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
    rerender(
      <FilterBar filters={{ ...base, status: 'PAID' }} onChange={vi.fn()} onClear={vi.fn()} />,
    )
    expect(screen.getByText('Clear filters')).toBeDefined()
  })

  it('picks a preset range and clears any custom dates', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={base} onChange={onChange} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(onChange).toHaveBeenCalledWith({ range: '3m', from: '', to: '' })
  })

  it('deselects the active preset on a second click', () => {
    const onChange = vi.fn()
    render(<FilterBar filters={{ ...base, range: '1w' }} onChange={onChange} onClear={vi.fn()} />)
    const btn = screen.getByRole('button', { name: '1W' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(onChange).toHaveBeenCalledWith({ range: '', from: '', to: '' })
  })

  it('shows the date pickers only for the custom range', () => {
    const { rerender } = render(<FilterBar filters={base} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByLabelText('From date')).toBeNull()
    rerender(<FilterBar filters={{ ...base, range: '6m' }} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByLabelText('From date')).toBeNull()
    rerender(
      <FilterBar filters={{ ...base, range: 'custom' }} onChange={vi.fn()} onClear={vi.fn()} />,
    )
    expect(screen.getByLabelText('From date')).toBeDefined()
    expect(screen.getByLabelText('To date')).toBeDefined()
  })

  it('warns when the from date is after the to date', () => {
    render(
      <FilterBar
        filters={{ ...base, range: 'custom', from: '2026-03-01', to: '2026-01-01' }}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/start date must be on or before/i)
  })
})
