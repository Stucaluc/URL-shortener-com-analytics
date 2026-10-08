import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { MemoryRepository } from '../src/repositories/memory.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgres://unused',
    BASE_URL: 'http://short.test',
    API_KEY: undefined,
    IP_HASH_SALT: 'test-salt-test-salt',
    COUNTRY_HEADER: undefined,
    TRUST_PROXY: false,
    AUTO_MIGRATE: false,
    CODE_LENGTH: 7,
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

export async function createTestApp(
  overrides: Partial<Config> = {},
): Promise<{ app: FastifyInstance; repository: MemoryRepository }> {
  const repository = new MemoryRepository();
  const app = await buildApp({ config: testConfig(overrides), repository });
  return { app, repository };
}

/** O clique é registrado de forma assíncrona (fire-and-forget); aguarda o ciclo do event loop. */
export const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));
