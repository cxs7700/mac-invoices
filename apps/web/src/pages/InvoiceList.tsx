import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export default function InvoiceList() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-foreground">Invoices</h1>
        <Button asChild>
          <Link to="/invoices/new">New invoice</Link>
        </Button>
      </div>
      <p className="text-muted-foreground">
        The invoice list lands in a later phase. For now this confirms the router and layout work.
      </p>
    </div>
  )
}
