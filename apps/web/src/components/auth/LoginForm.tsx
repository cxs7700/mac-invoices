import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LoginSchema, type LoginInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useLogin } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { fieldClass } from './authField'

export function LoginForm() {
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
  )
}
