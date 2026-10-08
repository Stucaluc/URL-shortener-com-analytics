import type { DeviceType } from './lib/useragent.js';

export interface Link {
  id: number;
  code: string;
  targetUrl: string;
  createdAt: Date;
  expiresAt: Date | null;
  clickCount: number;
}

export interface NewLink {
  code: string;
  targetUrl: string;
  expiresAt: Date | null;
}

export interface NewClick {
  linkId: number;
  referrer: string | null;
  browser: string;
  os: string;
  device: DeviceType;
  country: string | null;
  ipHash: string | null;
}

export interface Breakdown {
  label: string;
  clicks: number;
}

export interface DailyClicks {
  date: string;
  clicks: number;
}

export interface Stats {
  totalClicks: number;
  uniqueVisitors: number;
  clicksByDay: DailyClicks[];
  topReferrers: Breakdown[];
  browsers: Breakdown[];
  operatingSystems: Breakdown[];
  devices: Breakdown[];
  countries: Breakdown[];
}

export class CodeConflictError extends Error {
  constructor(public readonly code: string) {
    super(`O código "${code}" já está em uso`);
    this.name = 'CodeConflictError';
  }
}

/** Contrato de persistência; permite trocar PostgreSQL por uma implementação em memória nos testes. */
export interface Repository {
  createLink(input: NewLink): Promise<Link>;
  findByCode(code: string): Promise<Link | null>;
  listLinks(limit: number, offset: number): Promise<{ items: Link[]; total: number }>;
  deleteLink(code: string): Promise<boolean>;
  recordClick(click: NewClick): Promise<void>;
  getStats(linkId: number, days: number): Promise<Stats>;
  ping(): Promise<void>;
}
