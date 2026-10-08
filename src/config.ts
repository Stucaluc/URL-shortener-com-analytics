import { z } from 'zod';

/** Variáveis vazias (ex.: `API_KEY=` no .env ou no compose) são tratadas como ausentes. */
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    BASE_URL: z.url().default('http://localhost:3000'),
    API_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
    IP_HASH_SALT: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
    COUNTRY_HEADER: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^[a-z0-9-]+$/i)
        .transform((value) => value.toLowerCase())
        .optional(),
    ),
    TRUST_PROXY: booleanString('false'),
    AUTO_MIGRATE: booleanString('true'),
    CODE_LENGTH: z.coerce.number().int().min(4).max(16).default(7),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['API_KEY'], message: 'API_KEY é obrigatória em produção (mín. 16 caracteres)' });
    }
    if (!env.IP_HASH_SALT) {
      ctx.addIssue({ code: 'custom', path: ['IP_HASH_SALT'], message: 'IP_HASH_SALT é obrigatória em produção (mín. 16 caracteres)' });
    }
  })
  .transform((env) => ({
    ...env,
    BASE_URL: env.BASE_URL.replace(/\/+$/, ''),
    IP_HASH_SALT: env.IP_HASH_SALT ?? 'dev-only-insecure-salt-change-me',
  }));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${details}`);
  }
  return result.data;
}
