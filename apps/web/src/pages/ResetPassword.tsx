import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { ResetPasswordFormSchema, type ResetPasswordFormInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useResetPassword } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { fieldClass } from '@/components/auth/authField'

/**
 * Public reset page — a sibling of /login, outside AuthGuard, because the
 * person using it is by definition locked out.
 *
 * The token arrives in the URL FRAGMENT, not a path or query parameter:
 * fragments are not sent in Referer headers and never reach server access logs.
 * It is read once at module scope of the render, then posted in the body.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const reset = useResetPassword()
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') ?? ''

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(ResetPasswordFormSchema) as Resolver<ResetPasswordFormInput>,
  })

  const serverError =
    reset.error instanceof ApiError
      ? reset.error.message
      : reset.error
        ? 'Something went wrong. Please try again.'
        : null

  if (!token) {
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <h1 className="mb-4 text-2xl font-bold text-foreground">Reset your password</h1>
        <p className="text-sm text-destructive" role="alert">
          This reset link is incomplete. Ask for a new link.
        </p>
      </div>
    )
  }

  const onSubmit = handleSubmit(({ newPassword }) => {
    reset.mutate(
      { token, newPassword },
      // Straight to login rather than auto-signing them in: the reset destroyed
      // every session for this account, and proving the new password works is
      // the point of the exercise.
      { onSuccess: () => navigate('/login', { replace: true }) },
    )
  })

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-4 text-2xl font-bold text-foreground">Reset your password</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="newPassword" className="mb-1 block text-sm font-medium">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            // "new-password", not "off": browsers ignore `off` on password
            // inputs (DEC-031).
            autoComplete="new-password"
            className={fieldClass}
            {...register('newPassword')}
          />
          {errors.newPassword && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
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

        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {reset.isPending ? 'Setting…' : 'Set new password'}
        </Button>
      </form>
    </div>
  )
}
