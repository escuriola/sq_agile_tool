import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// numeric -> number (por defecto pg devuelve string)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// int8 -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// date -> 'YYYY-MM-DD' tal cual, sin conversión a Date (evita desfases de zona horaria)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://agile:agile@localhost:5433/agile',
});

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Could not connect to the database');
}

/**
 * Aplica en orden los .sql de src/migrations que aún no se hayan aplicado.
 * Cada migración va en su propia transacción y queda registrada en _migrations,
 * así que arrancar de nuevo nunca toca datos existentes.
 */
export async function migrate(): Promise<string[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  await pool.query(
    `create table if not exists _migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const done = await pool.query(`select 1 from _migrations where name = $1`, [file]);
    if (done.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query(`insert into _migrations (name) values ($1)`, [file]);
      await client.query('commit');
      applied.push(file);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`Failed applying migration ${file}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
