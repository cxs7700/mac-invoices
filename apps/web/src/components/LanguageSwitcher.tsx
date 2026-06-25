import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { useUpdateProfile } from '@/hooks/useSettings'

// Languages are labelled in their own script (autonyms).
const LABEL: Record<Locale, string> = { en: 'EN', zh: '中文' }

/**
 * Compact EN/中文 toggle. Always switches the UI language immediately (and the
 * detector mirrors it to localStorage). When `persist` is set (the authenticated
 * chrome), it also saves the choice to the user's profile so it carries across
 * devices; on the public contractor page `persist` is omitted (no session).
 */
export function LanguageSwitcher({ persist = false }: { persist?: boolean }) {
  const { t, i18n } = useTranslation()
  const update = useUpdateProfile()
  const current: Locale = i18n.language === 'zh' ? 'zh' : 'en'

  const choose = (next: Locale) => {
    if (next === current) return
    i18n.changeLanguage(next)
    if (persist) update.mutate({ locale: next })
  }

  return (
    <div
      role="group"
      aria-label={t('settings.language.title')}
      className="inline-flex overflow-hidden rounded-md border border-input text-xs"
    >
      {SUPPORTED_LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          aria-pressed={current === loc}
          onClick={() => choose(loc)}
          className={`px-2 py-1 ${
            current === loc
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          {LABEL[loc]}
        </button>
      ))}
    </div>
  )
}
