import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { CreateVendorSchema, type CreateVendorInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { VendorLinkCard } from '@/components/VendorLinkCard'
import { Button } from '@/components/ui/button'
import {
  useVendors,
  useCreateVendor,
  useRevokeLink,
  useReissueLink,
  useUpdateVendor,
  useDeleteVendor,
} from '@/hooks/useVendors'

const fieldClass = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

type FormInput = z.input<typeof CreateVendorSchema>

export default function Vendors() {
  const { t } = useTranslation()
  const { data, isPending, isError } = useVendors()
  const create = useCreateVendor()
  const revoke = useRevokeLink()
  const reissue = useReissueLink()
  const update = useUpdateVendor()
  const remove = useDeleteVendor()

  const createError = create.error instanceof ApiError ? create.error.message : null
  const updateError = update.error instanceof ApiError ? update.error.message : null

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, CreateVendorInput>({
    // zod v4 + @hookform/resolvers types don't line up with the 3-generic useForm;
    // the resolver behaves correctly at runtime, so assert the matching shape.
    resolver: zodResolver(CreateVendorSchema) as Resolver<FormInput, unknown, CreateVendorInput>,
  })

  const onCreate = handleSubmit((values) => {
    create.mutate(
      {
        name: values.name,
        phone: values.phone?.trim() || undefined,
        email: values.email?.trim() || undefined,
      },
      { onSuccess: () => reset() },
    )
  })

  const busy = revoke.isPending || reissue.isPending || remove.isPending
  const vendors = data?.data ?? []

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-foreground">{t('vendors.title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('vendors.subtitle')}</p>

      <form onSubmit={onCreate} className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              {t('vendors.nameLabel')}
            </label>
            <input id="name" className={fieldClass} {...register('name')} />
            {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              {t('vendors.phone')}
            </label>
            <input
              id="phone"
              type="tel"
              className={fieldClass}
              {...register('phone', { setValueAs: (v) => v || undefined })}
            />
            {errors.phone && (
              <p className="mt-1 text-sm text-destructive">{errors.phone.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              {t('vendors.email')}
            </label>
            <input
              id="email"
              type="email"
              className={fieldClass}
              {...register('email', { setValueAs: (v) => v || undefined })}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
        </div>
        {createError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {createError}
          </p>
        )}
        <Button type="submit" className="mt-3" disabled={create.isPending}>
          {create.isPending ? t('vendors.adding') : t('vendors.addButton')}
        </Button>
      </form>

      {isError ? (
        <p className="text-sm text-destructive">{t('vendors.loadError')}</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">{t('vendors.loading')}</p>
      ) : vendors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('vendors.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {vendors.map((v) => (
            <VendorLinkCard
              key={v.id}
              vendor={v}
              onSave={(values) => update.mutate({ id: v.id, ...values })}
              onDelete={() => remove.mutate(v.id)}
              onReissue={() => reissue.mutate(v.id)}
              onRevoke={() => revoke.mutate(v.id)}
              busy={busy}
              saving={update.isPending && update.variables?.id === v.id}
              saveError={update.variables?.id === v.id ? updateError : null}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
