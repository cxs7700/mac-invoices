import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SignupFormSchema, type SignupFormInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useSignup } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { fieldClass } from './authField'

export function SignupForm() {
  const navigate = useNavigate()
  const signup = useSignup()
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<SignupFormInput>({
    resolver: zodResolver(SignupFormSchema) as Resolver<SignupFormInput>,
  })

  // ApiError carries the server's message, so EMAIL_TAKEN ("An account with
  // this email already exists") and INVALID_INVITE_CODE surface as-is. The
  // one server string that IS translated client-side is SIGNUP_DISABLED — the
  // API's "Signup is not enabled" is always English, so render the localized
  // key instead of the raw server message.
  const serverError =
    signup.error instanceof ApiError
      ? signup.error.code === 'SIGNUP_DISABLED'
        ? t('login.signupDisabled')
        : signup.error.message
      : signup.error
        ? t('login.serverError')
        : null

  const onSubmit = handleSubmit(
    ({ confirmPassword: _confirmPassword, ...payload }) => {
      // `confirmPassword` is a client-side check only — the API parses
      // SignupSchema, which has no such field. Dropping it here keeps the
      // request shape exactly the server's contract.
      signup.mutate(payload, { onSuccess: () => navigate('/', { replace: true }) })
    },
    (errs) => {
      const first = (
        ['inviteCode', 'email', 'password', 'confirmPassword', 'firstName', 'lastName'] as const
      ).find((f) => errs[f])
      if (first) setFocus(first)
    },
  )

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="inviteCode" className="block text-sm font-medium mb-1">
          {t('login.inviteCode')}
        </label>
        <input
          id="inviteCode"
          type="text"
          // "off" — unlike on password inputs (where browsers deliberately
          // ignore it, hence "new-password" above), autocomplete="off" IS
          // honored on ordinary text inputs. Needed here because this field
          // sits directly above the password fields, which is exactly the
          // shape a password manager's looser heuristics use to guess a
          // username field — it can silently fill a saved email address in.
          // Do not "correct" this to new-password or delete it.
          autoComplete="off"
          className={fieldClass}
          {...register('inviteCode')}
        />
        {errors.inviteCode && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.inviteCode.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium mb-1">
            {t('login.firstName')}
          </label>
          <input id="firstName" type="text" className={fieldClass} {...register('firstName')} />
          {errors.firstName && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.firstName.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium mb-1">
            {t('login.lastName')}
          </label>
          <input id="lastName" type="text" className={fieldClass} {...register('lastName')} />
          {errors.lastName && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.lastName.message}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium mb-1">
          {t('login.email')}
        </label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          className={fieldClass}
          {...register('email')}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="signup-password" className="block text-sm font-medium mb-1">
          {t('login.password')}
        </label>
        <input
          id="signup-password"
          type="password"
          // "new-password", not "off": browsers deliberately ignore `off` on
          // password inputs. This is what stops a saved credential being
          // offered while the user is creating a different account.
          autoComplete="new-password"
          className={fieldClass}
          {...register('password')}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="signup-confirm-password" className="block text-sm font-medium mb-1">
          {t('login.confirmPassword')}
        </label>
        <input
          id="signup-confirm-password"
          type="password"
          autoComplete="new-password"
          className={fieldClass}
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      {serverError && (
        <p className="text-sm text-destructive" role="alert" aria-live="polite">
          {serverError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={signup.isPending}>
        {signup.isPending ? t('login.creatingAccount') : t('login.createAccount')}
      </Button>
    </form>
  )
}
