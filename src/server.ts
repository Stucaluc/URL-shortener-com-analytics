import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';
import { PostgresRepository } from './repositories/postgres.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);

  if (config.AUTO_MIGRATE) {
    await runMigrations(pool);
  }

  const app = await buildApp({ config, repository: new PostgresRepository(pool) });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'encerrando servidor');
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'falha no encerramento');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  if (!config.API_KEY) {
    app.log.warn('API_KEY não definida: a API de gerenciamento está aberta (use apenas em desenvolvimento)');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
