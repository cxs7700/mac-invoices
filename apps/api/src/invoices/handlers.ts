import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma } from '../../prisma/generated/client.ts';
import type {
  GetInvoiceParams,
  ListInvoicesQuery,
  CreateInvoiceBody,
  UpdateInvoiceBody,
} from './types.ts';

/** Narrow an unknown caught value to something with a Prisma error code. */
function isPrismaError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/** Safely extract a human-readable message from an unknown caught value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * POST /api/invoices
 * Create a new invoice
 */
export async function createInvoice(
  request: FastifyRequest<{ Body: CreateInvoiceBody }>,
  reply: FastifyReply
) {
  try {
    const { description, date, location, price, status, number, quantity, creatorId } = request.body;

    const invoice = await request.server.prisma.invoice.create({
      data: {
        description,
        date: new Date(date),
        location,
        price: typeof price === 'string' ? parseFloat(price) : price,
        status,
        number,
        quantity: quantity ?? null,
        creatorId,
      },
      include: {
        creator: true,
      },
    });

    return reply.code(201).send(invoice);
  } catch (error: unknown) {
    request.log.error(error);

    // Handle Prisma unique constraint errors
    if (isPrismaError(error) && error.code === 'P2002') {
      return reply.code(409).send({
        error: 'Invoice with this number already exists',
      });
    }

    return reply.code(500).send({
      error: 'Failed to create invoice',
      message: errorMessage(error),
    });
  }
}

/**
 * GET /api/invoices
 * List invoices with optional filters
 */
export async function listInvoices(
  request: FastifyRequest<{ Querystring: ListInvoicesQuery }>,
  reply: FastifyReply
) {
  try {
    const { status, creatorId, limit = '50', offset = '0' } = request.query;

    const where: Prisma.InvoiceWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (creatorId) {
      where.creatorId = parseInt(creatorId, 10);
    }

    const [invoices, total] = await Promise.all([
      request.server.prisma.invoice.findMany({
        where,
        include: {
          creator: true,
        },
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
        orderBy: {
          date: 'desc',
        },
      }),
      request.server.prisma.invoice.count({ where }),
    ]);

    return reply.send({
      data: invoices,
      pagination: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  } catch (error: unknown) {
    request.log.error(error);
    return reply.code(500).send({
      error: 'Failed to fetch invoices',
      message: errorMessage(error),
    });
  }
}

/**
 * GET /api/invoices/:id
 * Get a single invoice by ID
 */
export async function getInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const invoiceId = parseInt(id, 10);

    if (isNaN(invoiceId)) {
      return reply.code(400).send({ error: 'Invalid invoice ID' });
    }

    const invoice = await request.server.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        creator: true,
      },
    });

    if (!invoice) {
      return reply.code(404).send({ error: 'Invoice not found' });
    }

    return reply.send(invoice);
  } catch (error: unknown) {
    request.log.error(error);
    return reply.code(500).send({
      error: 'Failed to fetch invoice',
      message: errorMessage(error),
    });
  }
}

/**
 * PATCH /api/invoices/:id
 * Update an invoice
 */
export async function updateInvoice(
  request: FastifyRequest<{
    Params: GetInvoiceParams;
    Body: UpdateInvoiceBody;
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const invoiceId = parseInt(id, 10);

    if (isNaN(invoiceId)) {
      return reply.code(400).send({ error: 'Invalid invoice ID' });
    }

    const updateData: Prisma.InvoiceUncheckedUpdateInput = {};
    const { description, date, location, price, status, number, quantity, creatorId } = request.body;

    if (description !== undefined) updateData.description = description;
    if (date !== undefined) updateData.date = new Date(date);
    if (location !== undefined) updateData.location = location;
    if (price !== undefined) {
      updateData.price = typeof price === 'string' ? parseFloat(price) : price;
    }
    if (status !== undefined) updateData.status = status;
    if (number !== undefined) updateData.number = number;
    if (quantity !== undefined) updateData.quantity = quantity ?? null;
    if (creatorId !== undefined) updateData.creatorId = creatorId;

    const invoice = await request.server.prisma.invoice.update({
      where: { id: invoiceId },
      data: updateData,
      include: {
        creator: true,
      },
    });

    return reply.send(invoice);
  } catch (error: unknown) {
    request.log.error(error);

    // Handle Prisma not found error
    if (isPrismaError(error) && error.code === 'P2025') {
      return reply.code(404).send({ error: 'Invoice not found' });
    }

    // Handle Prisma unique constraint errors
    if (isPrismaError(error) && error.code === 'P2002') {
      return reply.code(409).send({
        error: 'Invoice with this number already exists',
      });
    }

    return reply.code(500).send({
      error: 'Failed to update invoice',
      message: errorMessage(error),
    });
  }
}

/**
 * DELETE /api/invoices/:id
 * Delete an invoice
 */
export async function deleteInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const invoiceId = parseInt(id, 10);

    if (isNaN(invoiceId)) {
      return reply.code(400).send({ error: 'Invalid invoice ID' });
    }

    await request.server.prisma.invoice.delete({
      where: { id: invoiceId },
    });

    return reply.code(204).send();
  } catch (error: unknown) {
    request.log.error(error);

    // Handle Prisma not found error
    if (isPrismaError(error) && error.code === 'P2025') {
      return reply.code(404).send({ error: 'Invoice not found' });
    }

    return reply.code(500).send({
      error: 'Failed to delete invoice',
      message: errorMessage(error),
    });
  }
}
