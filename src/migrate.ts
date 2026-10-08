import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

// Chave arbitrária do advisory lock: impede duas instâncias de migrarem ao mesmo tempo
const MIGRATION_LOCK_KEY = 727_274;

export const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

/** Aplica, em ordem alfabética, os arquivos .sql ainda não registrados em schema_migrations. */
export async function runMigrations(
  pool: Pool,
  dir: string = DEFAULT_MIGRATIONS_DIR,
  log: (message: string) => void = console.log,
): Promise<string[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    for (const file of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) continue;

      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falha ao aplicar a migration ${file}: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`Migration aplicada: ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }

  return applied;
}

// Execução direta: `npm run migrate`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  runMigrations(pool)
    .then((applied) => {
      console.log(applied.length === 0 ? 'Banco já está atualizado.' : `${applied.length} migration(s) aplicada(s).`);
    })
    .catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
