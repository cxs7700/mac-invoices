import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LoginSchema, type LoginInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useLogin } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'

const fieldClass =
  'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

export default function Login() {
  const navigate = useNavigate()
  const login = useLogin()
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) as Resolver<LoginInput> })

  const serverError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? t('login.serverError')
        : null

  const onSubmit = handleSubmit(
    (creds) => login.mutate(creds, { onSuccess: () => navigate('/', { replace: true }) }),
    (errs) => setFocus(errs.email ? 'email' : 'password'),
  )

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

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              {t('login.email')}
            </label>
            <input id="email" type="email" className={fieldClass} {...register('email')} />
            {errors.email && (
              <p className="mt-1 text-sm text-destructive" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              {t('login.password')}
            </label>
            <input id="password" type="password" className={fieldClass} {...register('password')} />
            {errors.password && (
              <p className="mt-1 text-sm text-destructive" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          {serverError && (
            <p className="text-sm text-destructive" role="alert" aria-live="polite">
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? t('login.signingIn') : t('login.logIn')}
          </Button>
        </form>
      </div>
    </div>
  )
}
