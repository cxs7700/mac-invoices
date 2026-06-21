import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

import { prisma } from '../src/lib/prisma'
import type { Prisma } from './generated/client.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

const LANDLORD_ID = process.env.LANDLORD_USER_ID ?? 'landlord_seed_user'
const LANDLORD_EMAIL = process.env.LANDLORD_EMAIL ?? 'landlord@example.com'

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
  await prisma.user.upsert({
    where: { id: LANDLORD_ID },
    update: {},
    create: {
      id: LANDLORD_ID,
      email: LANDLORD_EMAIL,
      name: 'Landlord',
      role: 'LANDLORD',
      // Auth lands in Phase 3, which replaces this with a real argon2 hash.
      passwordHash: 'PLACEHOLDER_SET_IN_PHASE_3',
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
      description: row.description,
      amount,
      currency: 'USD',
      category: 'OTHER',
      status: status ?? 'PENDING',
      invoiceDate,
      notes: notes || null,
      user: { connect: { id: LANDLORD_ID } },
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
