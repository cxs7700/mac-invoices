import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { useMe } from '@/hooks/useAuth'
import {
  useUpdateProfile,
  useChangePassword,
  useSheetsStatus,
  useSaveSheet,
  useTestSheet,
} from '@/hooks/useSettings'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

const inputClass = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
const errOf = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong' : null)

function ProfileSection() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const update = useUpdateProfile()
  const [firstName, setFirstName] = useState<string | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const firstNameValue = firstName ?? me?.firstName ?? ''
  const lastNameValue = lastName ?? me?.lastName ?? ''
  const emailValue = email ?? me?.email ?? ''

  return (
    <Section title={t('settings.profile.title')}>
      <div className="space-y-3">
        <div>
          <label htmlFor="firstName" className="text-sm font-medium text-foreground">{t('settings.profile.firstName')}</label>
          <input id="firstName" value={firstNameValue} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="lastName" className="text-sm font-medium text-foreground">{t('settings.profile.lastName')}</label>
          <input id="lastName" value={lastNameValue} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="email" className="text-sm font-medium text-foreground">{t('settings.profile.email')}</label>
          <input id="email" value={emailValue} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        {update.isSuccess && <p className="text-sm text-status-paid-foreground">{t('settings.profile.saved')}</p>}
        {errOf(update.error) && <p className="text-sm text-destructive" role="alert">{errOf(update.error)}</p>}
        <Button
          disabled={update.isPending || !firstNameValue.trim() || !emailValue.trim()}
          onClick={() =>
            update.mutate({
              firstName: firstNameValue.trim(),
              // "" (not undefined) so an intentional clear reaches the API —
              // undefined would mean "leave unchanged" and silently restore
              // the previous value.
              lastName: lastNameValue.trim(),
              email: emailValue.trim(),
            })
          }
        >
          {update.isPending ? t('common.saving') : t('settings.profile.save')}
        </Button>
      </div>
    </Section>
  )
}

function SecuritySection() {
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  return (
    <Section title="Security">
      <div className="space-y-3">
        <div>
          <label htmlFor="current" className="text-sm font-medium text-foreground">Current password</label>
          {/*
            autoComplete="new-password" on a field labelled "Current password"
            reads oddly on purpose. "current-password" is precisely the value
            that makes browsers prefill it, and a prefilled current-password box
            means the re-authentication gating a password change is satisfied by
            the browser rather than by the person at the keyboard. Do not
            "correct" this to current-password.
          */}
          <input id="current" type="password" autoComplete="new-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="next" className="text-sm font-medium text-foreground">New password</label>
          <input id="next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        {change.isSuccess && (
          <p className="text-sm text-status-paid-foreground">Password changed — you've been signed out on other devices.</p>
        )}
        {errOf(change.error) && <p className="text-sm text-destructive" role="alert">{errOf(change.error)}</p>}
        <Button
          disabled={change.isPending || !current || next.length < 8}
          onClick={() =>
            change.mutate({ currentPassword: current, newPassword: next }, { onSuccess: () => { setCurrent(''); setNext('') } })
          }
        >
          {change.isPending ? 'Changing…' : 'Change password'}
        </Button>
      </div>
    </Section>
  )
}

function SheetsSection() {
  const { data: status, isPending } = useSheetsStatus()
  const save = useSaveSheet()
  const test = useTestSheet()
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const value = sheetId ?? status?.targetSpreadsheetId ?? ''

  const copyEmail = () => {
    if (!status?.serviceAccountEmail) return
    setCopied(true)
    void navigator.clipboard?.writeText(status.serviceAccountEmail).catch(() => {})
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Section title="Google Sheets connection">
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">Status:</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              status?.configured && status?.reachable
                ? 'bg-status-paid text-status-paid-foreground'
                : 'bg-status-pending text-status-pending-foreground'
            }`}>
              {!status?.configured ? 'Not configured' : status?.reachable ? 'Connected' : 'Not reachable'}
            </span>
          </div>
          {status?.serviceAccountEmail && (
            <div>
              <span className="text-sm font-medium text-foreground">Share your sheet with</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="break-all rounded bg-background px-2 py-1 text-xs">{status.serviceAccountEmail}</code>
                <Button size="sm" variant="outline" onClick={copyEmail}>{copied ? 'Copied!' : 'Copy'}</Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Add it as an Editor on the spreadsheet.</p>
            </div>
          )}
          <div>
            <label htmlFor="sheetId" className="text-sm font-medium text-foreground">Target spreadsheet ID or URL</label>
            <input id="sheetId" value={value} onChange={(e) => setSheetId(e.target.value)} className={inputClass} />
          </div>
          {errOf(save.error) && <p className="text-sm text-destructive" role="alert">{errOf(save.error)}</p>}
          {test.isSuccess && <p className="text-sm text-status-paid-foreground">Connection works.</p>}
          {errOf(test.error) && <p className="text-sm text-destructive" role="alert">{errOf(test.error)}</p>}
          <div className="flex gap-2">
            <Button disabled={save.isPending || !value.trim()} onClick={() => save.mutate({ spreadsheetId: value.trim() })}>
              {save.isPending ? 'Saving…' : 'Save target'}
            </Button>
            <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}

export default function Settings() {
  const { t } = useTranslation()
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{t('settings.title')}</h1>
      <ProfileSection />
      <SecuritySection />
      <SheetsSection />
    </div>
  )
}
