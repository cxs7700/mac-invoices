import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { useUpdateProfile } from '@/hooks/useSettings'
import { SegmentedSwitcher } from './SegmentedSwitcher'

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
    i18n.changeLanguage(next)
    if (persist) update.mutate({ locale: next })
  }

  return (
    <SegmentedSwitcher
      options={SUPPORTED_LOCALES}
      value={current}
      onChange={choose}
      label={t('settings.language.title')}
      renderOption={(loc) => LABEL[loc]}
    />
  )
}
