import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

import { prisma } from '../src/lib/prisma'
import { hashPassword } from '../src/auth/password'
import type { Prisma } from './generated/client.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

const LANDLORD_ID = process.env.LANDLORD_USER_ID ?? 'landlord_seed_user'
// Normalized the same way login normalizes a submitted email (trim + lowercase,
// see EmailSchema in packages/shared) — login does an exact-match `findUnique`,
// so an uppercase LANDLORD_EMAIL would seed a row that can never log in.
// Re-running the seed self-heals a misconfigured (uppercase) env var instead of
// relying solely on the docs/DEPLOYMENT.md warning.
const LANDLORD_EMAIL = (process.env.LANDLORD_EMAIL ?? 'landlord@example.com').trim().toLowerCase()
const DEV_DEFAULT_PASSWORD = 'changeme-dev'

// Map the legacy CSV status string onto the §5 InvoiceStatus enum; unknown → PENDING.
const STATUS_MAP: Record<string, Prisma.InvoiceCreateInput['status']> = {
  paid: 'PAID',
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  // The 2025 CSV uses 'Invoiced' for sent-but-unpaid; no enum member exists, so
  // map it explicitly to PENDING rather than relying on the silent fallback.
  invoiced: 'PENDING',
}

const seedLandlord = async () => {
  const password = process.env.LANDLORD_PASSWORD
  if (!password) {
    throw new Error('LANDLORD_PASSWORD is required to seed the landlord login.')
  }
  if (process.env.NODE_ENV === 'production' && password === DEV_DEFAULT_PASSWORD) {
    throw new Error('Refusing to seed the default dev password in production.')
  }
  const passwordHash = await hashPassword(password)

  await prisma.user.upsert({
    where: { id: LANDLORD_ID },
    update: { passwordHash },
    create: {
      id: LANDLORD_ID,
      email: LANDLORD_EMAIL,
      name: 'Landlord',
      firstName: 'Landlord',
      role: 'LANDLORD',
      passwordHash,
    },
  })
}

type CsvRow = {
  number: string
  date: string
  description: string
  location: string
  price: string
  status: string
  notes: string
  parts: string
}

// Lossy remap of the 2025 CSV into the §5 model (DEC-007): vendorName/category are
// synthesized (no source column); location/parts/notes fold into `notes`.
const seedInvoices = async () => {
  const csvFilePath = path.resolve(here, 'seed-data.csv')
  const csvContent = fs.readFileSync(csvFilePath, 'utf-8')
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[]

  for (const row of rows) {
    const amount = parseFloat(row.price.replace(/[$,]/g, ''))
    if (Number.isNaN(amount)) continue

    const invoiceDate = new Date(row.date)
    if (Number.isNaN(invoiceDate.getTime())) {
      console.warn(`Skipping row ${row.number}: unparseable date "${row.date}"`)
      continue
    }

    const status = STATUS_MAP[row.status?.toLowerCase()]
    if (!status && row.status) {
      console.warn(`Row ${row.number}: unmapped status "${row.status}" -> PENDING`)
    }

    const notes = [
      row.location ? `Location: ${row.location}` : '',
      row.parts ? `Parts: ${row.parts}` : '',
      row.notes ?? '',
    ]
      .filter(Boolean)
      .join('; ')

    const data: Prisma.InvoiceCreateInput = {
      invoiceNumber: String(row.number),
      vendorName: 'Unknown vendor',
      amount,
      currency: 'USD',
      category: 'OTHER',
      status: status ?? 'PENDING',
      invoiceDate,
      notes: notes || null,
      user: { connect: { id: LANDLORD_ID } },
      items: { create: [{ description: row.description, quantity: 1, total: amount, sortOrder: 0 }] },
    }

    await prisma.invoice.upsert({
      where: { invoiceNumber: data.invoiceNumber },
      update: {},
      create: data,
    })
  }
}

async function main() {
  await seedLandlord()
  await seedInvoices()
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
