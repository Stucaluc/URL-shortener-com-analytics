CREATE TABLE links (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(32)  NOT NULL UNIQUE,
  target_url  TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  click_count BIGINT       NOT NULL DEFAULT 0
);

CREATE TABLE clicks (
  id         BIGSERIAL PRIMARY KEY,
  link_id    BIGINT       NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  referrer   VARCHAR(255),
  browser    VARCHAR(40),
  os         VARCHAR(40),
  device     VARCHAR(20),
  country    CHAR(2),
  ip_hash    CHAR(64)
);

-- Consultas de analytics sempre filtram por link e janela de tempo
CREATE INDEX clicks_link_id_clicked_at_idx ON clicks (link_id, clicked_at DESC);
CREATE INDEX links_created_at_idx ON links (created_at DESC);
