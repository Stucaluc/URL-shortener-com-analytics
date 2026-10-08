import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Identificador pseudônimo do visitante: HMAC-SHA256(salt, ip|user-agent).
 * O IP nunca é armazenado; o hash só serve para contar visitantes únicos.
 */
export function hashVisitor(ip: string, userAgent: string, salt: string): string {
  return createHmac('sha256', salt).update(`${ip}|${userAgent}`).digest('hex');
}

/** Guarda apenas o host do referrer (sem caminho nem query string). */
export function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const { hostname } = new URL(referrer);
    return hostname ? hostname.toLowerCase().slice(0, 255) : null;
  } catch {
    return null;
  }
}

/** Aceita somente códigos ISO 3166-1 alfa-2 em maiúsculas; ignora valores especiais (XX, T1). */
export function normalizeCountry(value: string | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
}

/** Comparação em tempo constante (resistente a timing attacks) de segredos de tamanhos diferentes. */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
