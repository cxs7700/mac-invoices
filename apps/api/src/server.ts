// ESM
import { buildApp } from './app'

const app = buildApp()

app.listen({ port: 3000 }, function (err) {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})

// Graceful shutdown: close the app so the db connector's onClose hook runs
// prisma.$disconnect() and in-flight requests drain before the process exits.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    try {
      await app.close()
    } finally {
      process.exit(0)
    }
  })
}
