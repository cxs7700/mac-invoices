import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'

import { prisma } from '../lib/prisma'
import type { Invoice } from '@/api/invoices/myTypes'

const seedUsers = async () => {
  const kim = await prisma.user.upsert({
    where: { id: 2 },
    update: {},
    create: {
      email: 'kim@prisma.io',
      name: 'Kim',
      invoices: {
        create: {
          description: "5b Sewer Pipe Leak & Ceiling Repair",
          date: new Date(),
          location: 'Sutton',
          price: 350,
          status: 'Paid',
          number: 115,
          quantity: 1
        }
      }
    }
  })

  const vivien = await prisma.user.upsert({
    where: { id: 3 },
    update: {},
    create: {
      email: 'vivien@prisma.io',
      name: 'Vivien',
      invoices: {
        create: {
          description: "Apt 203 Water Heater Replacement",
          date: new Date(),
          location: 'Sutton',
          price: 350,
          status: 'Paid',
          number: 116,
          quantity: 1
        }
      }
    }
  })
}

const seedInvoices = async () => {
  const csvFilePath = path.resolve(__dirname, '../invoices.csv')
  const csvContent = fs.readFileSync(csvFilePath, 'utf-8')
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[]
  for (const row of records) {
    const invoiceNumber = parseInt(row.number)
    const price = parseFloat(row.price.replace(/[$,]/g, ''))
    const date = new Date(row.date)
    await prisma.invoice.upsert({
      where: { number: invoiceNumber },
      update: {},
      create: { 
        ...row,
        number: invoiceNumber,
        price: price,
        date: date,
        creatorId: 1
      } as Invoice
    })
  }
}

async function main() {
  await seedUsers()
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