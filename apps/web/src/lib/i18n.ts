import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from '../locales/en/translation.json'
import zh from '../locales/zh/translation.json'

// Internationalization (KTD-4/KTD-5). Both locales are BUNDLED — no http-backend,
// so react-i18next resolves synchronously and there is no first-paint Suspense
// flash. `User.locale` is the server source of truth; the language-detector reads
// localStorage synchronously for first paint and caches changes back, and an
// effect near AuthGuard reconciles to the server value after login.

export const SUPPORTED_LOCALES = ['en', 'zh'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh'
}

/** BCP-47 tag for Intl, derived from the active i18n language. Currency stays USD. */
export function localeTag(): string {
  return i18n.language === 'zh' ? 'zh-CN' : 'en-US'
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, zh: { translation: zh } },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES,
    load: 'languageOnly', // collapse zh-CN / zh-Hans → 'zh'
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
    interpolation: { escapeValue: false }, // React already escapes
    react: { useSuspense: false },
  })

export default i18n
