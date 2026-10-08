import type { Pool } from 'pg';
import { windowStart } from '../lib/dates.js';
import {
  CodeConflictError,
  type Breakdown,
  type DailyClicks,
  type Link,
  type NewClick,
  type NewLink,
  type Repository,
  type Stats,
} from '../repository.js';

interface LinkRow {
  id: string;
  code: string;
  target_url: string;
  created_at: Date;
  expires_at: Date | null;
  click_count: string;
}

type BreakdownColumn = 'referrer' | 'browser' | 'os' | 'device' | 'country';

const TOP_LIMIT = 10;
const UNIQUE_VIOLATION = '23505';

function mapLink(row: LinkRow): Link {
  return {
    id: Number(row.id),
    code: row.code,
    targetUrl: row.target_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    clickCount: Number(row.click_count),
  };
}

export class PostgresRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  async createLink(input: NewLink): Promise<Link> {
    try {
      const { rows } = await this.pool.query<LinkRow>(
        `INSERT INTO links (code, target_url, expires_at)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.code, input.targetUrl, input.expiresAt],
      );
      return mapLink(rows[0] as LinkRow);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new CodeConflictError(input.code);
      throw error;
    }
  }

  async findByCode(code: string): Promise<Link | null> {
    const { rows } = await this.pool.query<LinkRow>('SELECT * FROM links WHERE code = $1', [code]);
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async listLinks(limit: number, offset: number): Promise<{ items: Link[]; total: number }> {
    const [list, count] = await Promise.all([
      this.pool.query<LinkRow>('SELECT * FROM links ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2', [
        limit,
        offset,
      ]),
      this.pool.query<{ total: string }>('SELECT count(*) AS total FROM links'),
    ]);
    return { items: list.rows.map(mapLink), total: Number(count.rows[0]?.total ?? 0) };
  }

  async deleteLink(code: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM links WHERE code = $1', [code]);
    return (result.rowCount ?? 0) > 0;
  }

  async recordClick(click: NewClick): Promise<void> {
    // Insere o clique e incrementa o contador denormalizado em uma única instrução (atômica).
    await this.pool.query(
      `WITH inserted AS (
         INSERT INTO clicks (link_id, referrer, browser, os, device, country, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING link_id
       )
       UPDATE links SET click_count = click_count + 1
       WHERE id IN (SELECT link_id FROM inserted)`,
      [click.linkId, click.referrer, click.browser, click.os, click.device, click.country, click.ipHash],
    );
  }

  async getStats(linkId: number, days: number): Promise<Stats> {
    const since = windowStart(days);

    const [totals, daily, referrers, browsers, systems, devices, countries] = await Promise.all([
      this.pool.query<{ total: number; uniques: number }>(
        `SELECT count(*)::int AS total, count(DISTINCT ip_hash)::int AS uniques
         FROM clicks
         WHERE link_id = $1 AND clicked_at >= $2::date`,
        [linkId, since],
      ),
      this.pool.query<DailyClicks>(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS date, coalesce(c.clicks, 0)::int AS clicks
         FROM generate_series($2::date, (now() AT TIME ZONE 'UTC')::date, interval '1 day') AS d(day)
         LEFT JOIN (
           SELECT (clicked_at AT TIME ZONE 'UTC')::date AS day, count(*) AS clicks
           FROM clicks
           WHERE link_id = $1 AND clicked_at >= $2::date
           GROUP BY 1
         ) c ON c.day = d.day::date
         ORDER BY d.day`,
        [linkId, since],
      ),
      this.breakdown(linkId, since, 'referrer', 'Direct'),
      this.breakdown(linkId, since, 'browser', 'Unknown'),
      this.breakdown(linkId, since, 'os', 'Unknown'),
      this.breakdown(linkId, since, 'device', 'Unknown'),
      this.breakdown(linkId, since, 'country', 'Unknown'),
    ]);

    return {
      totalClicks: totals.rows[0]?.total ?? 0,
      uniqueVisitors: totals.rows[0]?.uniques ?? 0,
      clicksByDay: daily.rows,
      topReferrers: referrers,
      browsers,
      operatingSystems: systems,
      devices,
      countries,
    };
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /** `column` vem de uma união fixa de literais (nunca de input externo), por isso a interpolação é segura. */
  private async breakdown(
    linkId: number,
    since: string,
    column: BreakdownColumn,
    fallback: string,
  ): Promise<Breakdown[]> {
    const { rows } = await this.pool.query<Breakdown>(
      `SELECT coalesce(${column}::text, $3) AS label, count(*)::int AS clicks
       FROM clicks
       WHERE link_id = $1 AND clicked_at >= $2::date
       GROUP BY 1
       ORDER BY clicks DESC, label ASC
       LIMIT ${TOP_LIMIT}`,
      [linkId, since, fallback],
    );
    return rows;
  }
}
