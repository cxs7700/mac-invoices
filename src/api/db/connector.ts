import fastifyPrisma from '@joggr/fastify-prisma';
// import { PrismaClient } from '../prisma/generated/client';
import { prisma } from '../../lib/prisma.ts'
import type { FastifyInstance } from 'fastify';

// Add this so you get types across the board
declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

/**
 * Database connector plugin
 * @param {FastifyInstance} fastify  Encapsulated Fastify Instance
 * @param {Object} options plugin options, refer to https://fastify.dev/docs/latest/Reference/Plugins/#plugin-options
 */
async function dbConnector (fastify: FastifyInstance) {
  await fastify.register(fastifyPrisma, {
    client: prisma,
  });
}

//ESM
export default dbConnector;