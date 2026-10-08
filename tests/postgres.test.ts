import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { PostgresRepository } from '../src/repositories/postgres.js';
import { CodeConflictError } from '../src/repository.js';

/**
 * Testes de integração com PostgreSQL real.
 * Só rodam quando TEST_DATABASE_URL está definida. ATENÇÃO: as tabelas do banco indicado são
 * truncadas a cada teste; use sempre um banco descartável.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgresRepository (integração)', () => {
  let pool: pg.Pool;
  let repository: PostgresRepository;

  beforeAll(async () => {
    pool = createPool(databaseUrl as string);
    await runMigrations(pool, undefined, () => undefined);
    repository = new PostgresRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE clicks, links RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('migrations são idempotentes', async () => {
    expect(await runMigrations(pool, undefined, () => undefined)).toEqual([]);
  });

  it('cria, busca, lista e remove links', async () => {
    const link = await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });
    expect(link).toMatchObject({ code: 'abc123', targetUrl: 'https://exemplo.com/', clickCount: 0, expiresAt: null });

    expect((await repository.findByCode('abc123'))?.id).toBe(link.id);
    expect(await repository.findByCode('nada')).toBeNull();

    await repository.createLink({ code: 'def456', targetUrl: 'https://exemplo.com/2', expiresAt: null });
    const listed = await repository.listLinks(10, 0);
    expect(listed.total).toBe(2);
    expect(listed.items.map((item) => item.code)).toEqual(['def456', 'abc123']);

    expect(await repository.deleteLink('abc123')).toBe(true);
    expect(await repository.deleteLink('abc123')).toBe(false);
  });

  it('lança CodeConflictError para código repetido', async () => {
    await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });
    await expect(
      repository.createLink({ code: 'abc123', targetUrl: 'https://outro.com/', expiresAt: null }),
    ).rejects.toBeInstanceOf(CodeConflictError);
  });

  it('registra cliques, incrementa o contador e agrega as estatísticas', async () => {
    const link = await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });
    const base = { linkId: link.id, os: 'Windows', device: 'desktop' as const };

    await repository.recordClick({ ...base, referrer: 'twitter.com', browser: 'Chrome', country: 'BR', ipHash: 'h1' });
    await repository.recordClick({ ...base, referrer: 'twitter.com', browser: 'Chrome', country: 'BR', ipHash: 'h1' });
    await repository.recordClick({ ...base, referrer: null, browser: 'Firefox', country: null, ipHash: 'h2' });

    expect((await repository.findByCode('abc123'))?.clickCount).toBe(3);

    const stats = await repository.getStats(link.id, 7);
    expect(stats.totalClicks).toBe(3);
    expect(stats.uniqueVisitors).toBe(2);
    expect(stats.clicksByDay).toHaveLength(7);
    expect(stats.clicksByDay.reduce((sum, day) => sum + day.clicks, 0)).toBe(3);
    expect(stats.clicksByDay.at(-1)?.clicks).toBe(3);
    expect(stats.topReferrers).toEqual([
      { label: 'twitter.com', clicks: 2 },
      { label: 'Direct', clicks: 1 },
    ]);
    expect(stats.browsers).toEqual([
      { label: 'Chrome', clicks: 2 },
      { label: 'Firefox', clicks: 1 },
    ]);
    expect(stats.countries).toEqual([
      { label: 'BR', clicks: 2 },
      { label: 'Unknown', clicks: 1 },
    ]);
  });

  it('exclui cliques fora da janela e remove cliques junto com o link', async () => {
    const link = await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });
    await repository.recordClick({
      linkId: link.id, referrer: null, browser: 'Chrome', os: 'Windows', device: 'desktop', country: null, ipHash: 'h1',
    });
    await pool.query("UPDATE clicks SET clicked_at = now() - interval '40 days'");

    expect((await repository.getStats(link.id, 30)).totalClicks).toBe(0);
    expect((await repository.getStats(link.id, 60)).totalClicks).toBe(1);

    await repository.deleteLink('abc123');
    const remaining = await pool.query('SELECT count(*)::int AS n FROM clicks');
    expect(remaining.rows[0].n).toBe(0);
  });
});
