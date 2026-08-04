import type { ReactNode } from 'react'

/**
 * Compact segmented control — the shared shape behind LanguageSwitcher and
 * ThemeSwitcher (chrome preference toggles). One button per option with
 * `aria-pressed` state; selecting the active option is a no-op.
 */
export function SegmentedSwitcher<T extends string>({
  options,
  value,
  onChange,
  label,
  renderOption,
  optionLabel,
}: {
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  /** Accessible name for the group. */
  label: string
  renderOption: (option: T) => ReactNode
  /** Accessible name per segment — required when renderOption yields icons. */
  optionLabel?: (option: T) => string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-input text-xs"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          aria-label={optionLabel?.(option)}
          onClick={() => {
            if (option !== value) onChange(option)
          }}
          className={`px-2 py-1 ${
            value === option
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          {renderOption(option)}
        </button>
      ))}
    </div>
  )
}
