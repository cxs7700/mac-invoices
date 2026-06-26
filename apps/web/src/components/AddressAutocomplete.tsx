import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { searchAddresses, type AddressSuggestion } from '@/lib/geocode'

interface AddressAutocompleteProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/**
 * Free-text address input with type-ahead suggestions from OpenStreetMap (via
 * `searchAddresses`). The field stays fully editable — suggestions just save the
 * landlord typing the whole address. Selecting one stores its single-line form.
 */
export function AddressAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  className,
}: AddressAutocompleteProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<AddressSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  // Suppress the lookup triggered by programmatically setting `value` on select.
  const skipNextLookup = useRef(false)

  // Debounced lookup whenever the typed value changes.
  useEffect(() => {
    if (skipNextLookup.current) {
      skipNextLookup.current = false
      return
    }

    const tooShort = value.trim().length < 3
    const controller = new AbortController()
    const handle = setTimeout(() => {
      if (tooShort) {
        setResults([])
        setLoading(false)
        return
      }
      setLoading(true)
      searchAddresses(value, controller.signal)
        .then((found) => {
          setResults(found)
          setActive(-1)
          setOpen(true)
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, tooShort ? 0 : 300)

    return () => {
      controller.abort()
      clearTimeout(handle)
    }
  }, [value])

  // Close the dropdown when clicking away.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const select = (s: AddressSuggestion) => {
    skipNextLookup.current = true
    onChange(s.value)
    setResults([])
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      select(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showPanel = open && value.trim().length >= 3

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showPanel}
        aria-autocomplete="list"
        className={className}
      />
      {showPanel && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {loading && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t('addressAutocomplete.searching')}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t('addressAutocomplete.noResults')}
            </p>
          ) : (
            <ul role="listbox">
              {results.map((s, i) => (
                <li key={s.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(s)}
                    onMouseEnter={() => setActive(i)}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent ${
                      i === active ? 'bg-accent' : ''
                    }`}
                  >
                    <span className="text-foreground">{s.primary}</span>
                    {s.secondary && (
                      <span className="text-muted-foreground">{`, ${s.secondary}`}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-border px-3 py-1 text-[11px] text-muted-foreground">
            {t('addressAutocomplete.poweredBy')}
          </p>
        </div>
      )}
    </div>
  )
}
