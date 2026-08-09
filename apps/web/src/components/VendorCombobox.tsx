import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { cn } from '@/lib/utils'

type VendorOption = { id: string; name: string }

type Props = {
  id: string
  /** Current text in the field, from the form's `watch` — drives filtering. */
  value: string
  vendors: VendorOption[]
  /** Spread onto the input so react-hook-form keeps owning validation + ref. */
  field: UseFormRegisterReturn
  /** Called when an option is chosen from the list (never on plain typing). */
  onPick: (vendor: VendorOption) => void
  className?: string
}

/**
 * Vendor picker: a text input that opens a real dropdown of saved vendors on
 * click or focus, rather than the native <datalist> it replaces — that only
 * appeared once the user had typed, and rendered as a suggestion popup with no
 * affordance hinting a list existed.
 *
 * Free text is still first-class: the input is an ordinary registered field, so
 * typing a name that matches nothing submits without a vendorId and the server
 * auto-creates the vendor (DEC-032(d)). The dropdown only ever *adds* an id.
 */
export function VendorCombobox({ id, value, vendors, field, onPick, className }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = useId()

  // An exact match means the user just picked (or is editing an invoice that
  // already has this vendor). Filtering to the single row it matches would make
  // reopening the list useless, so show everything in that case.
  const exact = vendors.some((v) => v.name === value)
  const query = value?.trim().toLowerCase() ?? ''
  const options =
    exact || query === '' ? vendors : vendors.filter((v) => v.name.toLowerCase().includes(query))

  function close() {
    setOpen(false)
    setActiveIndex(-1)
  }

  function pick(vendor: VendorOption) {
    onPick(vendor)
    close()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setActiveIndex(0)
        return
      }
      setActiveIndex((i) => (options.length === 0 ? -1 : (i + 1) % options.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      setActiveIndex((i) => (options.length === 0 ? -1 : (i <= 0 ? options.length : i) - 1))
      return
    }
    if (e.key === 'Enter') {
      // Only swallow Enter when it is actually choosing an option — otherwise
      // Enter must keep submitting the form as it always has.
      if (open && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault()
        pick(options[activeIndex])
      }
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      }
      return
    }
    if (e.key === 'Tab') close()
  }

  return (
    <div
      className="relative"
      // Closes on click-away and on tabbing out, without a document-level
      // listener: focus moving anywhere outside this subtree closes the list.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close()
      }}
    >
      <div className="relative">
        <input
          {...field}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 && options[activeIndex]
              ? `${listId}-${options[activeIndex].id}`
              : undefined
          }
          autoComplete="off"
          className={cn(className, 'pr-9')}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            // Typing re-filters, so an old highlight would point at the wrong row.
            setActiveIndex(-1)
            setOpen(true)
            void field.onChange(e)
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('invoiceForm.vendorToggle')}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((wasOpen) => !wasOpen)
            setActiveIndex(-1)
          }}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('invoiceForm.vendorListLabel')}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {vendors.length === 0
                ? t('invoiceForm.vendorNoneSaved')
                : t('invoiceForm.vendorNoMatch')}
            </li>
          ) : (
            options.map((v, i) => (
              <li
                key={v.id}
                id={`${listId}-${v.id}`}
                role="option"
                aria-selected={v.name === value}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm',
                  i === activeIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'text-popover-foreground',
                )}
                // mousedown would blur the input and close the list before the
                // click landed, so suppress it and act on click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(v)}
              >
                {v.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
