import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Aliases/códigos aceitos: letras, números, hífen e underscore (3 a 32 caracteres). */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** Caminhos de primeiro nível usados pela própria aplicação (comparação em minúsculas). */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['api', 'health', 'dashboard', 'admin']);

/** Gera um código aleatório (base62) usando fonte criptograficamente segura. */
export function generateCode(length = 7): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

export function isValidCodeFormat(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code.toLowerCase());
}
