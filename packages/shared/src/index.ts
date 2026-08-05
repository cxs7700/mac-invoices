// Shared Zod schemas and TypeScript types consumed by both @mac-invoices/web and
// @mac-invoices/api. See PROJECT_PLAN.md §6.

export const SHARED_PACKAGE_VERSION = '0.0.0'

export * from './schemas/invoice'
export * from './schemas/auth'
export * from './schemas/contractor'
export * from './schemas/settings'
export * from './schemas/notification'
export * from './schemas/property'
export * from './lib/invoiceOrder'
