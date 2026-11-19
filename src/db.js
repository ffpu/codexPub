import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';

export function connect(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Configura DATABASE_URL.');
  return new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
}

export async function transaction(pool, run) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function migrate(pool, mode) {
  if (!['demo', 'pilot'].includes(mode)) throw new Error('APP_MODE debe ser demo o pilot.');
  return transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(18643)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const dir = new URL('../migrations/', import.meta.url);
    const files = (await readdir(dir)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    const { rows } = await db.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(row => row.name));
    for (const file of files.filter(name => !applied.has(name))) {
      await db.query(await readFile(new URL(file, dir), 'utf8'));
      await db.query('INSERT INTO schema_migrations VALUES ($1)', [file]);
    }
    await db.query('INSERT INTO deployment VALUES (1,$1) ON CONFLICT DO NOTHING', [mode]);
    const { rows: [deployment] } = await db.query('SELECT mode FROM deployment WHERE id=1');
    if (deployment.mode !== mode) throw new Error('La base pertenece a otro entorno.');
  });
}
