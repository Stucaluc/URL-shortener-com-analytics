import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { Config } from './config.js';
import { generateCode, isReservedCode, isValidCodeFormat } from './lib/code.js';
import { hashVisitor, normalizeCountry, referrerHost, safeEqual } from './lib/privacy.js';
import { InvalidUrlError, normalizeTargetUrl } from './lib/url.js';
import { parseUserAgent } from './lib/useragent.js';
import { CodeConflictError, type Link, type Repository } from './repository.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MAX_CODE_ATTEMPTS = 5;

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const createLinkBody = z.object({
  url: z.string().min(1, 'url é obrigatória'),
  alias: z.string().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const statsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

function parseWith<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      400,
      'validation_error',
      'Parâmetros inválidos',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export interface BuildAppOptions {
  config: Config;
  repository: Repository;
}

export async function buildApp({ config, repository }: BuildAppOptions): Promise<FastifyInstance> {
  const isProduction = config.NODE_ENV === 'production';

  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 10 * 1024,
  });

  const selfHost = new URL(config.BASE_URL).host;

  const toDto = (link: Link) => ({
    code: link.code,
    shortUrl: `${config.BASE_URL}/${link.code}`,
    targetUrl: link.targetUrl,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    clickCount: link.clickCount,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // upgrade-insecure-requests quebra o acesso via http://localhost em alguns navegadores
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
  });

  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.errorCode,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.code ?? 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'erro não tratado');
    return reply.code(500).send({ error: 'internal_error', message: 'Erro interno do servidor' });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'Recurso não encontrado' }),
  );

  // ---------- Infra ----------

  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await repository.ping();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  // ---------- Dashboard (arquivos estáticos em /dashboard/) ----------

  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/dashboard/' });
  app.get('/', { config: { rateLimit: false } }, async (_request, reply) => reply.redirect('/dashboard/', 302));
  app.get('/dashboard', { config: { rateLimit: false } }, async (_request, reply) =>
    reply.redirect('/dashboard/', 302),
  );

  // ---------- API de gerenciamento (protegida por x-api-key quando configurada) ----------

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (request) => {
        if (!config.API_KEY) return;
        const provided = request.headers['x-api-key'];
        if (typeof provided !== 'string' || !safeEqual(provided, config.API_KEY)) {
          throw new HttpError(401, 'unauthorized', 'API key ausente ou inválida (header x-api-key)');
        }
      });

      api.post('/links', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = parseWith(createLinkBody, request.body);

        let targetUrl: string;
        try {
          targetUrl = normalizeTargetUrl(body.url, { selfHost });
        } catch (error) {
          if (error instanceof InvalidUrlError) throw new HttpError(400, 'invalid_url', error.message);
          throw error;
        }

        let expiresAt: Date | null = null;
        if (body.expiresAt) {
          expiresAt = new Date(body.expiresAt);
          if (expiresAt.getTime() <= Date.now()) {
            throw new HttpError(400, 'invalid_expiration', 'expiresAt deve estar no futuro');
          }
        }

        if (body.alias !== undefined) {
          if (!isValidCodeFormat(body.alias)) {
            throw new HttpError(
              400,
              'invalid_alias',
              'alias deve ter de 3 a 32 caracteres: letras, números, hífen ou underscore',
            );
          }
          if (isReservedCode(body.alias)) {
            throw new HttpError(400, 'reserved_alias', 'Este alias é reservado pelo sistema');
          }
          try {
            const link = await repository.createLink({ code: body.alias, targetUrl, expiresAt });
            return reply.code(201).send(toDto(link));
          } catch (error) {
            if (error instanceof CodeConflictError) throw new HttpError(409, 'alias_taken', error.message);
            throw error;
          }
        }

        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
          const code = generateCode(config.CODE_LENGTH);
          if (isReservedCode(code)) continue;
          try {
            const link = await repository.createLink({ code, targetUrl, expiresAt });
            return reply.code(201).send(toDto(link));
          } catch (error) {
            if (error instanceof CodeConflictError) continue;
            throw error;
          }
        }
        throw new HttpError(503, 'code_generation_failed', 'Não foi possível gerar um código único; tente novamente');
      });

      api.get('/links', async (request) => {
        const { limit, offset } = parseWith(listQuery, request.query);
        const { items, total } = await repository.listLinks(limit, offset);
        return { items: items.map(toDto), total, limit, offset };
      });

      api.get<{ Params: { code: string } }>('/links/:code', async (request) => {
        const link = await requireLink(request.params.code);
        return toDto(link);
      });

      api.delete<{ Params: { code: string } }>('/links/:code', async (request, reply) => {
        const removed = isValidCodeFormat(request.params.code) && (await repository.deleteLink(request.params.code));
        if (!removed) throw new HttpError(404, 'not_found', 'Link não encontrado');
        return reply.code(204).send();
      });

      api.get<{ Params: { code: string } }>('/links/:code/stats', async (request) => {
        const { days } = parseWith(statsQuery, request.query);
        const link = await requireLink(request.params.code);
        const stats = await repository.getStats(link.id, days);
        return { code: link.code, days, ...stats };
      });

      async function requireLink(code: string): Promise<Link> {
        const link = isValidCodeFormat(code) ? await repository.findByCode(code) : null;
        if (!link) throw new HttpError(404, 'not_found', 'Link não encontrado');
        return link;
      }
    },
    { prefix: '/api/v1' },
  );

  // ---------- Redirecionamento público (registra o clique sem bloquear a resposta) ----------

  app.get<{ Params: { code: string } }>('/:code', async (request, reply: FastifyReply) => {
    const { code } = request.params;
    const link = isValidCodeFormat(code) ? await repository.findByCode(code) : null;
    if (!link) throw new HttpError(404, 'not_found', 'Link não encontrado');

    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(410, 'expired', 'Este link expirou');
    }

    const userAgent = request.headers['user-agent'] ?? '';
    const parsed = parseUserAgent(userAgent);
    const countryHeader = config.COUNTRY_HEADER ? request.headers[config.COUNTRY_HEADER] : undefined;

    void repository
      .recordClick({
        linkId: link.id,
        referrer: referrerHost(request.headers.referer),
        browser: parsed.browser,
        os: parsed.os,
        device: parsed.device,
        country: normalizeCountry(typeof countryHeader === 'string' ? countryHeader : undefined),
        ipHash: hashVisitor(request.ip, userAgent, config.IP_HASH_SALT),
      })
      .catch((error: unknown) => request.log.error({ err: error }, 'falha ao registrar clique'));

    // 302 (e não 301) para que os navegadores não façam cache e cada clique chegue ao servidor
    return reply.header('Cache-Control', 'no-store').redirect(link.targetUrl, 302);
  });

  return app;
}
