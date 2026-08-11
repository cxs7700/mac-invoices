import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Share, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The Chromium-only event that lets a page trigger its own install flow. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'submitInstallDismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, 'true')
  } catch {
    // Private mode — the banner just reappears next visit, which is survivable.
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates display-mode and exposes its own flag instead.
    (navigator as { standalone?: boolean }).standalone === true
  )
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/**
 * Offers to add the submission link to the vendor's home screen.
 *
 * Two paths, because the platforms differ: Chromium fires
 * `beforeinstallprompt` and lets us drive the install; iOS Safari has no such
 * API, so all we can do is tell the vendor which button to press. Showing the
 * iOS instructions unconditionally would nag every desktop visitor, so it is
 * gated to actual iOS devices that are not already installed.
 */
export function InstallPrompt() {
  const { t } = useTranslation()
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(wasDismissed)
  // Platform facts, not state: they cannot change for the life of the page, so
  // reading them during the initial render beats setting state from an effect.
  const [showIosHint] = useState(() => isIos() && !isStandalone())

  useEffect(() => {
    if (isStandalone()) return

    const onBeforeInstall = (e: Event) => {
      // Chromium shows its own mini-infobar otherwise; we want the offer inline
      // with the form, where it reads as part of the flow.
      e.preventDefault()
      setDeferred(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    // Nothing to offer once it is installed.
    const onInstalled = () => setDeferred(null)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (dismissed || (!deferred && !showIosHint)) return null

  const dismiss = () => {
    rememberDismissed()
    setDismissed(true)
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    // The event is single-use: a second prompt() call throws.
    setDeferred(null)
  }

  return (
    <div className="relative rounded-lg border border-primary/30 bg-primary/5 p-4">
      <button
        type="button"
        aria-label={t('common.dismiss')}
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1.5 text-muted-foreground hover:bg-accent"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <p className="pr-8 text-sm font-medium text-foreground">{t('install.title')}</p>
      {deferred ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{t('install.body')}</p>
          <Button size="sm" className="mt-3" onClick={() => void install()}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('install.action')}
          </Button>
        </>
      ) : (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {t('install.iosStep1')}
          <Share className="inline h-3.5 w-3.5" aria-hidden="true" />
          {t('install.iosStep2')}
        </p>
      )}
    </div>
  )
}
