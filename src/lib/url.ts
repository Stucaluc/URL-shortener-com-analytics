export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

export const MAX_URL_LENGTH = 2048;

export interface NormalizeOptions {
  /** Host do próprio encurtador; destinos apontando para ele são recusados (evita laços de redirect). */
  selfHost?: string;
}

/**
 * Valida e normaliza a URL de destino.
 * Aceita apenas http/https, sem credenciais embutidas e sem apontar para o próprio serviço.
 */
export function normalizeTargetUrl(raw: string, options: NormalizeOptions = {}): string {
  const value = raw.trim();
  if (value.length === 0) throw new InvalidUrlError('A URL não pode ser vazia');
  if (value.length > MAX_URL_LENGTH) {
    throw new InvalidUrlError(`A URL excede o limite de ${MAX_URL_LENGTH} caracteres`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidUrlError('URL inválida (informe o endereço completo, ex.: https://exemplo.com)');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlError('Somente URLs http:// e https:// são permitidas');
  }
  if (parsed.username || parsed.password) {
    throw new InvalidUrlError('URLs com usuário/senha embutidos não são permitidas');
  }
  if (options.selfHost && parsed.host.toLowerCase() === options.selfHost.toLowerCase()) {
    throw new InvalidUrlError('A URL de destino não pode apontar para o próprio encurtador');
  }

  return parsed.toString();
}
