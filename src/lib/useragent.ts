export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

export interface ParsedUserAgent {
  browser: string;
  os: string;
  device: DeviceType;
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|curl\/|wget\/|python-requests|httpclient|go-http-client|okhttp/i;

/**
 * Parser leve baseado em expressões regulares, suficiente para estatísticas agregadas.
 * Não pretende cobrir todos os agentes; a ordem das regras importa (ex.: Edge e Opera
 * também contêm "Chrome" no UA, e iPad/iPhone contêm "like Mac OS X").
 */
export function parseUserAgent(userAgent: string | undefined): ParsedUserAgent {
  const ua = (userAgent ?? '').trim();
  if (ua === '') return { browser: 'Unknown', os: 'Unknown', device: 'unknown' };

  if (BOT_PATTERN.test(ua)) return { browser: 'Bot', os: detectOs(ua), device: 'bot' };

  return { browser: detectBrowser(ua), os: detectOs(ua), device: detectDevice(ua) };
}

function detectBrowser(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

function detectOs(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Other';
}

function detectDevice(ua: string): DeviceType {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'mobile' : 'tablet';
  if (/Mobile|iPhone|iPod/.test(ua)) return 'mobile';
  return 'desktop';
}
