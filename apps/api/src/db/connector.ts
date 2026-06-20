import fp from 'fastify-plugin';
import { prisma } from '../lib/prisma.ts'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

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
async function dbConnector (fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // Manually decorate fastify with prisma client
  fastify.decorate('prisma', prisma);
  
  // Ensure prisma disconnects when server closes
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}

//ESM
// Use fastify-plugin to make the decoration available to other plugins
export default fp(dbConnector);