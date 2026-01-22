import { prisma } from '../../lib/prisma'

async function main() {
  // Create a new user with an invoice
  const user = await prisma.user.create({
    data: {
      name: 'Kim',
      email: 'kim@prisma.io',
      invoices: {
        create: {
          description: 'This is my first invoice!',
          date: new Date(),
          location: 'Home',
          price: 5000.00,
          status: "Paid",
          number: 100,
          quantity: 1
        },
      },
    },
    include: {
      invoices: true,
    },
  })
  console.log('Created user:', user)

  // Fetch all users with their invoices
  const allUsers = await prisma.user.findMany({
    include: {
      invoices: true,
    },
  })
  console.log('All users:', JSON.stringify(allUsers, null, 2))
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