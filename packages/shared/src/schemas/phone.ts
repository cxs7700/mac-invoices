import { z } from 'zod'
import { formatPhone } from '../lib/formatPhone'

// A phone number as entered on any form (vendor, property owner). Normalized at
// the schema boundary rather than only on display, so one stored shape reaches
// every consumer — the list, the PDF, the Sheets mirror — instead of each
// formatting it for itself. Numbers that aren't 10-digit North-American are
// stored as typed (see formatPhone).
export const PhoneSchema = z.string().trim().min(1).max(50).transform(formatPhone)
