import pg from 'pg';

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Garante que date_trunc/::date e a janela de analytics usem sempre UTC
    options: '-c timezone=UTC',
  });
  // Erros em conexões ociosas não devem derrubar o processo
  pool.on('error', (error) => {
    console.error('Erro inesperado em conexão ociosa do PostgreSQL:', error.message);
  });
  return pool;
}
