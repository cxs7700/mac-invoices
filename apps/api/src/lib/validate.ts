import type { ZodType } from 'zod'
import { AppError } from '../middleware/errorHandler'

/**
 * Validate `data` against a Zod schema, returning the parsed value or throwing
 * an AppError that the central handler renders as the §7 VALIDATION_ERROR shape.
 */
export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid request body', 400, result.error.flatten())
  }
  return result.data
}
