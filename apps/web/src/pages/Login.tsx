import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoginForm } from '@/components/auth/LoginForm'
import { SignupForm } from '@/components/auth/SignupForm'
import { Button } from '@/components/ui/button'

type Mode = 'login' | 'signup'

export default function Login() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('login')

  const tabClass = (active: boolean) =>
    active
      ? 'rounded bg-card py-1.5 text-center font-medium text-foreground'
      : 'rounded py-1.5 text-center text-muted-foreground hover:text-foreground'

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-7">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold text-foreground">{t('app.name')}</div>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === 'login' ? t('login.welcome') : t('login.signUpWelcome')}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1 text-sm">
          <button
            type="button"
            className={tabClass(mode === 'login')}
            aria-label={t('login.switchToLogIn')}
            aria-pressed={mode === 'login'}
            onClick={() => setMode('login')}
          >
            {t('login.logIn')}
          </button>
          <button
            type="button"
            className={tabClass(mode === 'signup')}
            aria-label={t('login.switchToSignUp')}
            aria-pressed={mode === 'signup'}
            onClick={() => setMode('signup')}
          >
            {t('login.signUp')}
          </button>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full mb-3"
          aria-disabled="true"
          aria-label={t('login.googleAria')}
          tabIndex={-1}
          disabled
        >
          {t('login.google')}
          <span className="ml-2 text-xs text-muted-foreground">{t('nav.soon')}</span>
        </Button>

        <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> {t('login.or')}{' '}
          <span className="h-px flex-1 bg-border" />
        </div>

        {mode === 'login' ? <LoginForm /> : <SignupForm />}
      </div>
    </div>
  )
}
