import { describe, expect, it } from 'vitest';
import { generateCode, isReservedCode, isValidCodeFormat } from '../src/lib/code.js';
import { windowDays, windowStart } from '../src/lib/dates.js';
import { hashVisitor, normalizeCountry, referrerHost, safeEqual } from '../src/lib/privacy.js';
import { InvalidUrlError, normalizeTargetUrl } from '../src/lib/url.js';
import { parseUserAgent } from '../src/lib/useragent.js';
import { loadConfig } from '../src/config.js';

describe('code', () => {
  it('gera códigos base62 com o tamanho pedido', () => {
    const code = generateCode(9);
    expect(code).toHaveLength(9);
    expect(code).toMatch(/^[0-9A-Za-z]+$/);
  });

  it('gera códigos distintos', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode(7)));
    expect(codes.size).toBe(200);
  });

  it('valida formato de alias', () => {
    expect(isValidCodeFormat('meu-link_1')).toBe(true);
    expect(isValidCodeFormat('ab')).toBe(false);
    expect(isValidCodeFormat('com espaço')).toBe(false);
    expect(isValidCodeFormat('../etc')).toBe(false);
    expect(isValidCodeFormat('a'.repeat(33))).toBe(false);
  });

  it('reconhece códigos reservados sem diferenciar maiúsculas', () => {
    expect(isReservedCode('API')).toBe(true);
    expect(isReservedCode('Dashboard')).toBe(true);
    expect(isReservedCode('promo')).toBe(false);
  });
});

describe('normalizeTargetUrl', () => {
  it('aceita http e https', () => {
    expect(normalizeTargetUrl('https://exemplo.com/a?b=1')).toBe('https://exemplo.com/a?b=1');
    expect(normalizeTargetUrl('  http://exemplo.com  ')).toBe('http://exemplo.com/');
  });

  it.each([
    ['vazia', ''],
    ['sem protocolo', 'exemplo.com'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['ftp', 'ftp://exemplo.com/arquivo'],
    ['credenciais embutidas', 'https://user:pass@exemplo.com'],
    ['muito longa', `https://exemplo.com/${'a'.repeat(2100)}`],
  ])('recusa URL %s', (_name, value) => {
    expect(() => normalizeTargetUrl(value)).toThrow(InvalidUrlError);
  });

  it('recusa apontar para o próprio encurtador', () => {
    expect(() => normalizeTargetUrl('http://short.test/abc', { selfHost: 'short.test' })).toThrow(InvalidUrlError);
    expect(() => normalizeTargetUrl('http://SHORT.test/abc', { selfHost: 'short.test' })).toThrow(InvalidUrlError);
  });
});

describe('parseUserAgent', () => {
  const cases: Array<[string, string, ReturnType<typeof parseUserAgent>]> = [
    [
      'Chrome no Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      { browser: 'Chrome', os: 'Windows', device: 'desktop' },
    ],
    [
      'Edge no Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      { browser: 'Edge', os: 'Windows', device: 'desktop' },
    ],
    [
      'Safari no iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      { browser: 'Safari', os: 'iOS', device: 'mobile' },
    ],
    [
      'Chrome no Android (celular)',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      { browser: 'Chrome', os: 'Android', device: 'mobile' },
    ],
    [
      'Chrome no Android (tablet)',
      'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      { browser: 'Chrome', os: 'Android', device: 'tablet' },
    ],
    [
      'Firefox no Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
      { browser: 'Firefox', os: 'Linux', device: 'desktop' },
    ],
    [
      'Safari no macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      { browser: 'Safari', os: 'macOS', device: 'desktop' },
    ],
    [
      'Googlebot',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      { browser: 'Bot', os: 'Other', device: 'bot' },
    ],
  ];

  it.each(cases)('%s', (_name, ua, expected) => {
    expect(parseUserAgent(ua)).toEqual(expected);
  });

  it('trata user-agent ausente', () => {
    expect(parseUserAgent(undefined)).toEqual({ browser: 'Unknown', os: 'Unknown', device: 'unknown' });
  });
});

describe('privacy', () => {
  it('gera hash estável e dependente do salt', () => {
    const a = hashVisitor('203.0.113.9', 'UA', 'salt-salt-salt-salt');
    expect(a).toBe(hashVisitor('203.0.113.9', 'UA', 'salt-salt-salt-salt'));
    expect(a).not.toBe(hashVisitor('203.0.113.9', 'UA', 'outro-salt-outro-salt'));
    expect(a).not.toBe(hashVisitor('203.0.113.10', 'UA', 'salt-salt-salt-salt'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('203.0.113.9');
  });

  it('mantém só o host do referrer', () => {
    expect(referrerHost('https://Exemplo.com/caminho?segredo=1')).toBe('exemplo.com');
    expect(referrerHost('nao-e-url')).toBeNull();
    expect(referrerHost(undefined)).toBeNull();
  });

  it('normaliza país', () => {
    expect(normalizeCountry('br')).toBe('BR');
    expect(normalizeCountry('XX')).toBeNull();
    expect(normalizeCountry('T1')).toBeNull();
    expect(normalizeCountry('BRA')).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
  });

  it('compara segredos em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('dates', () => {
  const now = new Date('2026-03-10T15:30:00Z');

  it('calcula início da janela em UTC', () => {
    expect(windowStart(1, now)).toBe('2026-03-10');
    expect(windowStart(7, now)).toBe('2026-03-04');
  });

  it('lista os dias da janela em ordem', () => {
    expect(windowDays(3, now)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('atravessa virada de mês', () => {
    expect(windowDays(3, new Date('2026-03-01T00:00:00Z'))).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });
});

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

  it('aplica padrões em desenvolvimento e remove a barra final de BASE_URL', () => {
    const config = loadConfig({ ...base, BASE_URL: 'https://s.exemplo.com/' });
    expect(config.PORT).toBe(3000);
    expect(config.BASE_URL).toBe('https://s.exemplo.com');
    expect(config.API_KEY).toBeUndefined();
    expect(config.AUTO_MIGRATE).toBe(true);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('trata variáveis vazias como ausentes', () => {
    const config = loadConfig({ ...base, API_KEY: '', COUNTRY_HEADER: '' });
    expect(config.API_KEY).toBeUndefined();
    expect(config.COUNTRY_HEADER).toBeUndefined();
  });

  it('exige API_KEY e IP_HASH_SALT em produção', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/API_KEY/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', API_KEY: 'x'.repeat(16) }),
    ).toThrow(/IP_HASH_SALT/);
    const ok = loadConfig({
      ...base,
      NODE_ENV: 'production',
      API_KEY: 'x'.repeat(16),
      IP_HASH_SALT: 'y'.repeat(16),
    });
    expect(ok.NODE_ENV).toBe('production');
  });

  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
