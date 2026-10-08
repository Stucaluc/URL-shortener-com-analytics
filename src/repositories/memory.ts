import { utcDateString, windowDays, windowStart } from '../lib/dates.js';
import {
  CodeConflictError,
  type Breakdown,
  type Link,
  type NewClick,
  type NewLink,
  type Repository,
  type Stats,
} from '../repository.js';

interface StoredClick extends NewClick {
  clickedAt: Date;
}

const TOP_LIMIT = 10;

/** Implementação em memória usada nos testes (sem banco). Reproduz as regras do repositório PostgreSQL. */
export class MemoryRepository implements Repository {
  private links = new Map<string, Link>();
  private clicks: StoredClick[] = [];
  private nextId = 1;

  async createLink(input: NewLink): Promise<Link> {
    if (this.links.has(input.code)) throw new CodeConflictError(input.code);
    const link: Link = {
      id: this.nextId++,
      code: input.code,
      targetUrl: input.targetUrl,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      clickCount: 0,
    };
    this.links.set(link.code, link);
    return { ...link };
  }

  async findByCode(code: string): Promise<Link | null> {
    const link = this.links.get(code);
    return link ? { ...link } : null;
  }

  async listLinks(limit: number, offset: number): Promise<{ items: Link[]; total: number }> {
    const all = [...this.links.values()].sort((a, b) => b.id - a.id);
    return { items: all.slice(offset, offset + limit).map((link) => ({ ...link })), total: all.length };
  }

  async deleteLink(code: string): Promise<boolean> {
    const link = this.links.get(code);
    if (!link) return false;
    this.links.delete(code);
    this.clicks = this.clicks.filter((click) => click.linkId !== link.id);
    return true;
  }

  async recordClick(click: NewClick): Promise<void> {
    const link = [...this.links.values()].find((candidate) => candidate.id === click.linkId);
    if (!link) return;
    link.clickCount += 1;
    this.clicks.push({ ...click, clickedAt: new Date() });
  }

  async getStats(linkId: number, days: number): Promise<Stats> {
    const since = windowStart(days);
    const inWindow = this.clicks.filter(
      (click) => click.linkId === linkId && utcDateString(click.clickedAt) >= since,
    );

    const perDay = new Map<string, number>();
    for (const click of inWindow) {
      const day = utcDateString(click.clickedAt);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    const breakdown = (pick: (click: StoredClick) => string | null, fallback: string): Breakdown[] => {
      const counts = new Map<string, number>();
      for (const click of inWindow) {
        const label = pick(click) ?? fallback;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([label, clicks]) => ({ label, clicks }))
        .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label))
        .slice(0, TOP_LIMIT);
    };

    return {
      totalClicks: inWindow.length,
      uniqueVisitors: new Set(inWindow.map((click) => click.ipHash).filter((hash) => hash !== null)).size,
      clicksByDay: windowDays(days).map((date) => ({ date, clicks: perDay.get(date) ?? 0 })),
      topReferrers: breakdown((click) => click.referrer, 'Direct'),
      browsers: breakdown((click) => click.browser, 'Unknown'),
      operatingSystems: breakdown((click) => click.os, 'Unknown'),
      devices: breakdown((click) => click.device, 'Unknown'),
      countries: breakdown((click) => click.country, 'Unknown'),
    };
  }

  async ping(): Promise<void> {}
}
