import { Logger } from '@nestjs/common';
import { Redis as IORedis } from 'ioredis';

/**
 * Creates an ioredis client with sanitized connection event logging.
 *
 * Bull v4.16.5 uses its own bundled ioredis 5.11.1. When Bull's
 * `createClient` option is provided, Bull delegates connection creation
 * to this function instead of its internal default. We use it to:
 *
 * 1. Create the Redis connection with the provided options
 * 2. Attach diagnostic event listeners (connect, ready, error, reconnecting)
 * 3. Never log passwords, tokens, or credentials
 *
 * Bull calls createClient three times: 'client', 'subscriber', 'bclient'.
 * Each gets its own tagged logger so you can distinguish which connection
 * had an issue.
 */

const logger = new Logger('BullRedis');

export function createBullRedisClient(
  type: 'client' | 'subscriber' | 'bclient',
  redisOpts: Record<string, unknown>,
): IORedis {
  // Bull passes maxRetriesPerRequest: null for bclient/subscriber internally.
  // We just forward whatever Bull gives us.
  const client = new IORedis(redisOpts as any);

  const tag = `[${type}]`;

  client.on('connect', () => {
    logger.log(`${tag} Redis TCP connection established`);
  });

  client.on('ready', () => {
    logger.log(`${tag} Redis connection ready for commands`);
  });

  client.on('error', (err: Error) => {
    // Sanitize: remove any connection string from the error message
    const safeMsg = err.message?.replace(
      /redis[s]?:\/\/[^\s]+/gi,
      'redis://***redacted***',
    );
    logger.error(`${tag} Redis error: ${safeMsg ?? err.message}`);
  });

  client.on('reconnecting', (delay: number) => {
    logger.warn(`${tag} Redis reconnecting in ${delay}ms`);
  });

  client.on('close', () => {
    logger.warn(`${tag} Redis connection closed`);
  });

  return client;
}
