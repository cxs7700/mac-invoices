import { Link, Outlet } from 'react-router'
import { useHealth } from '@/hooks/useHealth'

function HealthIndicator() {
  const { data, isPending, isError } = useHealth()
  const label = isPending ? 'checking…' : isError ? 'unreachable' : (data?.status ?? 'unknown')
  const color = isPending
    ? 'bg-muted-foreground'
    : isError
      ? 'bg-destructive'
      : 'bg-green-500'

  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      API: {label}
    </span>
  )
}

function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-4">
            <Link to="/" className="font-semibold text-foreground">
              Mac Invoices
            </Link>
            <Link to="/invoices/new" className="text-sm text-muted-foreground hover:text-foreground">
              New
            </Link>
          </nav>
          <HealthIndicator />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export default App
