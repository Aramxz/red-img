import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000
});

const categories = ['Fotografía', 'Diseño UI', 'Arte Digital', 'Arquitectura'];

export async function migrate() {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  logger.info('database schema ready');
}

export async function seedPins() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM pins');
  if (rows[0].count > 0) return;

  const values = Array.from({ length: 24 }).map((_, index) => {
    const height = 260 + ((index * 47) % 360);
    const category = categories[index % categories.length];

    return [
      randomUUID(),
      `${category} ${index + 1}`,
      `Creador ${(index * 13) % 100}`,
      category,
      `https://picsum.photos/seed/kromos-${index + 100}/400/${height}`,
      `https://i.pravatar.cc/150?u=kromos-${index}`,
      false,
      false,
      false
    ];
  });

  for (const pin of values) {
    await pool.query(
      `INSERT INTO pins (id, title, author, category, image_url, avatar_url, liked, saved, is_local)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      pin
    );
  }

  logger.info({ count: values.length }, 'seed pins inserted');
}
