import { useParams } from 'react-router'

export default function InvoiceDetail() {
  const { id } = useParams()
  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground mb-2">Invoice {id}</h1>
      <p className="text-muted-foreground">Invoice detail lands in a later phase.</p>
    </div>
  )
}
