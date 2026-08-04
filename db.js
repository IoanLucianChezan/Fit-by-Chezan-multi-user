const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL lipseste din .env - conecteaza o baza Postgres (ex: Neon) si adauga connection string-ul');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function one(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0];
}
async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}
async function run(sql, params = []) {
  return pool.query(sql, params);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      ai_daily_limit INTEGER NOT NULL DEFAULT 20,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
  `);
}

async function seedAdmin() {
  const existing = await one('SELECT id FROM users WHERE role = $1', ['admin']);
  if (existing) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[db] Nu exista niciun admin si ADMIN_PASSWORD nu e setat in .env - seed admin sarit.');
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  const created = await one(
    'INSERT INTO users (username, password_hash, role, ai_daily_limit, active) VALUES ($1, $2, $3, $4, true) RETURNING id',
    [username, hash, 'admin', 100000]
  );
  await run('INSERT INTO user_data (user_id, data_json) VALUES ($1, $2)', [created.id, '{}']);
  console.log(`[db] Cont admin creat: ${username}`);
}

async function initDb() {
  await initSchema();
  await seedAdmin();
}

module.exports = { pool, one, all, run, todayStr, initDb };
