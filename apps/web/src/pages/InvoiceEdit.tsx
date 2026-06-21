import { useParams } from 'react-router'

export default function InvoiceEdit() {
  const { id } = useParams()
  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground mb-2">Edit invoice {id}</h1>
      <p className="text-muted-foreground">Invoice editing lands in a later phase.</p>
    </div>
  )
}
