import { useTranslation } from 'react-i18next'
import { LoginForm } from '@/components/auth/LoginForm'
import { Button } from '@/components/ui/button'

export default function Login() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-7">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold text-foreground">{t('app.name')}</div>
          <p className="text-sm text-muted-foreground mt-1">{t('login.welcome')}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1 text-sm">
          <span className="rounded bg-card py-1.5 text-center font-medium text-foreground">
            {t('login.logIn')}
          </span>
          <span
            className="py-1.5 text-center text-muted-foreground"
            aria-disabled="true"
            title={t('login.signUpSoon')}
          >
            {t('login.signUp')}
          </span>
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
          <span className="h-px flex-1 bg-border" /> {t('login.or')} <span className="h-px flex-1 bg-border" />
        </div>

        <LoginForm />
      </div>
    </div>
  )
}
