import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, flushAsync } from './helpers.js';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('criação de links', () => {
  it('cria link com código gerado', async () => {
    ({ app } = await createTestApp());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/links',
      payload: { url: 'https://exemplo.com/pagina' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(body.shortUrl).toBe(`http://short.test/${body.code}`);
    expect(body.targetUrl).toBe('https://exemplo.com/pagina');
    expect(body.clickCount).toBe(0);
  });

  it('cria link com alias e rejeita alias repetido (409)', async () => {
    ({ app } = await createTestApp());
    const payload = { url: 'https://exemplo.com', alias: 'promo-2026' };
    const first = await app.inject({ method: 'POST', url: '/api/v1/links', payload });
    expect(first.statusCode).toBe(201);
    expect(first.json().code).toBe('promo-2026');

    const second = await app.inject({ method: 'POST', url: '/api/v1/links', payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('alias_taken');
  });

  it.each([
    ['URL inválida', { url: 'nao-e-url' }, 'invalid_url'],
    ['esquema perigoso', { url: 'javascript:alert(1)' }, 'invalid_url'],
    ['aponta para o próprio serviço', { url: 'http://short.test/x' }, 'invalid_url'],
    ['alias inválido', { url: 'https://a.com', alias: 'a b' }, 'invalid_alias'],
    ['alias reservado', { url: 'https://a.com', alias: 'api' }, 'reserved_alias'],
    ['expiração no passado', { url: 'https://a.com', expiresAt: '2020-01-01T00:00:00Z' }, 'invalid_expiration'],
    ['sem url', {}, 'validation_error'],
    ['expiresAt malformado', { url: 'https://a.com', expiresAt: 'amanhã' }, 'validation_error'],
  ])('retorna 400 para %s', async (_name, payload, errorCode) => {
    ({ app } = await createTestApp());
    const response = await app.inject({ method: 'POST', url: '/api/v1/links', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(errorCode);
  });
});

describe('autenticação por API key', () => {
  const API_KEY = 'k'.repeat(24);

  it('bloqueia a API sem a chave e libera com a chave correta', async () => {
    ({ app } = await createTestApp({ API_KEY }));

    const denied = await app.inject({ method: 'GET', url: '/api/v1/links' });
    expect(denied.statusCode).toBe(401);

    const wrong = await app.inject({ method: 'GET', url: '/api/v1/links', headers: { 'x-api-key': 'errada' } });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({ method: 'GET', url: '/api/v1/links', headers: { 'x-api-key': API_KEY } });
    expect(ok.statusCode).toBe(200);
  });

  it('mantém o redirecionamento e o health públicos', async () => {
    const { app: instance, repository } = await createTestApp({ API_KEY });
    app = instance;
    await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });

    expect((await app.inject({ method: 'GET', url: '/abc123' })).statusCode).toBe(302);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('redirecionamento e registro de cliques', () => {
  it('redireciona com 302, sem cache, e registra o clique', async () => {
    const { app: instance, repository } = await createTestApp({ COUNTRY_HEADER: 'cf-ipcountry' });
    app = instance;
    await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/destino', expiresAt: null });

    const response = await app.inject({
      method: 'GET',
      url: '/abc123',
      headers: {
        'user-agent': CHROME_UA,
        referer: 'https://twitter.com/algum/caminho?x=1',
        'cf-ipcountry': 'br',
      },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://exemplo.com/destino');
    expect(response.headers['cache-control']).toBe('no-store');

    await flushAsync();
    const link = await repository.findByCode('abc123');
    expect(link?.clickCount).toBe(1);

    const stats = await repository.getStats(link!.id, 7);
    expect(stats.totalClicks).toBe(1);
    expect(stats.uniqueVisitors).toBe(1);
    expect(stats.topReferrers).toEqual([{ label: 'twitter.com', clicks: 1 }]);
    expect(stats.browsers).toEqual([{ label: 'Chrome', clicks: 1 }]);
    expect(stats.operatingSystems).toEqual([{ label: 'Windows', clicks: 1 }]);
    expect(stats.devices).toEqual([{ label: 'desktop', clicks: 1 }]);
    expect(stats.countries).toEqual([{ label: 'BR', clicks: 1 }]);
  });

  it('ignora o header de país quando COUNTRY_HEADER não está configurado', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    const link = await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });

    await app.inject({ method: 'GET', url: '/abc123', headers: { 'cf-ipcountry': 'BR' } });
    await flushAsync();

    const stats = await repository.getStats(link.id, 7);
    expect(stats.countries).toEqual([{ label: 'Unknown', clicks: 1 }]);
  });

  it('retorna 404 para código inexistente ou malformado', async () => {
    ({ app } = await createTestApp());
    expect((await app.inject({ method: 'GET', url: '/naoexiste' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/a%20b' })).statusCode).toBe(404);
  });

  it('retorna 410 para link expirado e não registra clique', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    const link = await repository.createLink({
      code: 'velho1',
      targetUrl: 'https://exemplo.com/',
      expiresAt: new Date(Date.now() - 1000),
    });

    const response = await app.inject({ method: 'GET', url: '/velho1' });
    expect(response.statusCode).toBe(410);
    await flushAsync();
    expect((await repository.getStats(link.id, 7)).totalClicks).toBe(0);
  });

  it('conta visitantes únicos por IP+user-agent', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    const link = await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });

    await app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': 'UA-A' }, remoteAddress: '10.0.0.1' });
    await app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': 'UA-A' }, remoteAddress: '10.0.0.1' });
    await app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': 'UA-B' }, remoteAddress: '10.0.0.2' });
    await flushAsync();

    const stats = await repository.getStats(link.id, 7);
    expect(stats.totalClicks).toBe(3);
    expect(stats.uniqueVisitors).toBe(2);
  });
});

describe('consulta, estatísticas e remoção', () => {
  it('lista com paginação e retorna total', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    for (const code of ['aaa', 'bbb', 'ccc']) {
      await repository.createLink({ code, targetUrl: 'https://exemplo.com/', expiresAt: null });
    }

    const response = await app.inject({ method: 'GET', url: '/api/v1/links?limit=2&offset=0' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.total).toBe(3);
    expect(body.items.map((item: { code: string }) => item.code)).toEqual(['ccc', 'bbb']);

    expect((await app.inject({ method: 'GET', url: '/api/v1/links?limit=1000' })).statusCode).toBe(400);
  });

  it('retorna estatísticas com série diária completa', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });
    await app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': CHROME_UA } });
    await flushAsync();

    const response = await app.inject({ method: 'GET', url: '/api/v1/links/abc123/stats?days=7' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.code).toBe('abc123');
    expect(body.days).toBe(7);
    expect(body.totalClicks).toBe(1);
    expect(body.clicksByDay).toHaveLength(7);
    expect(body.clicksByDay.at(-1).clicks).toBe(1);

    expect((await app.inject({ method: 'GET', url: '/api/v1/links/abc123/stats?days=0' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/links/nada/stats' })).statusCode).toBe(404);
  });

  it('remove link e responde 404 depois', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    await repository.createLink({ code: 'abc123', targetUrl: 'https://exemplo.com/', expiresAt: null });

    expect((await app.inject({ method: 'DELETE', url: '/api/v1/links/abc123' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/abc123' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/links/abc123' })).statusCode).toBe(404);
  });
});

describe('infraestrutura', () => {
  it('health responde ok', async () => {
    ({ app } = await createTestApp());
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('health responde 503 quando o banco falha', async () => {
    const { app: instance, repository } = await createTestApp();
    app = instance;
    repository.ping = async () => {
      throw new Error('db down');
    };
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(503);
  });

  it('serve o dashboard em /dashboard/ e redireciona a raiz', async () => {
    ({ app } = await createTestApp());
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe('/dashboard/');

    const page = await app.inject({ method: 'GET', url: '/dashboard/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");

    const script = await app.inject({ method: 'GET', url: '/dashboard/app.js' });
    expect(script.statusCode).toBe(200);
  });

  it('aplica o limite de requisições na criação de links', async () => {
    ({ app } = await createTestApp());
    const statuses: number[] = [];
    for (let i = 0; i < 32; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/links',
        payload: { url: 'https://exemplo.com/' },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 30).every((status) => status === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
