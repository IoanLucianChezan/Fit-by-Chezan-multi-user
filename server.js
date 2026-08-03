require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, todayStr } = require('./db');
const {
  hashPassword,
  verifyPassword,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin
} = require('./auth');
const { generateWithFallback, visionTranscribe } = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' })); // poze base64 la transcriere pot fi mari
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Auth
// ============================================================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username si parola sunt obligatorii.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Username sau parola gresita.' });
  }
  const token = signToken(user);
  setSessionCookie(res, token);
  res.json({ username: user.username, role: user.role });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username si parola sunt obligatorii.' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username-ul trebuie sa aiba cel putin 3 caractere.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Parola trebuie sa aiba cel putin 6 caractere.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Exista deja un cont cu acest username.' });
  }
  const defaultLimit = Number(process.env.DEFAULT_USER_AI_LIMIT) || 5;
  const hash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, ai_daily_limit, active) VALUES (?, ?, ?, ?, 1)')
    .run(username, hash, 'user', defaultLimit);
  db.prepare('INSERT INTO user_data (user_id, data_json) VALUES (?, ?)').run(info.lastInsertRowid, '{}');

  const token = signToken({ id: info.lastInsertRowid, username, role: 'user' });
  setSessionCookie(res, token);
  res.status(201).json({ username, role: 'user' });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const day = todayStr();
  const usage = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(req.user.id, day);
  res.json({
    username: req.user.username,
    role: req.user.role,
    aiDailyLimit: req.user.ai_daily_limit,
    aiUsedToday: usage?.count || 0
  });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Completează parola curentă și parola nouă.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Parola nouă trebuie să aibă cel puțin 6 caractere.' });
  }
  if (!verifyPassword(currentPassword, req.user.password_hash)) {
    return res.status(401).json({ error: 'Parola curentă e greșită.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

// ============================================================
// Date utilizator (inlocuieste localStorage)
// ============================================================

app.get('/api/data', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ?').get(req.user.id);
  res.json(row ? JSON.parse(row.data_json) : {});
});

app.put('/api/data', requireAuth, (req, res) => {
  const json = JSON.stringify(req.body || {});
  const existing = db.prepare('SELECT user_id FROM user_data WHERE user_id = ?').get(req.user.id);
  if (existing) {
    db.prepare("UPDATE user_data SET data_json = ?, updated_at = datetime('now') WHERE user_id = ?").run(
      json,
      req.user.id
    );
  } else {
    db.prepare('INSERT INTO user_data (user_id, data_json) VALUES (?, ?)').run(req.user.id, json);
  }
  res.json({ ok: true });
});

// ============================================================
// AI (proxy server-side, cu limita zilnica per user)
// ============================================================

function checkAndReserveQuota(userId, limit) {
  const day = todayStr();
  const row = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day);
  const used = row?.count || 0;
  if (used >= limit) return { ok: false, used };
  return { ok: true, used, day };
}

function incrementQuota(userId, day) {
  const existing = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day);
  if (existing) {
    db.prepare('UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND day = ?').run(userId, day);
  } else {
    db.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)').run(userId, day);
  }
}

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'Lipsesc mesajele pentru AI.' });
  }
  const quota = checkAndReserveQuota(req.user.id, req.user.ai_daily_limit);
  if (!quota.ok) {
    return res.status(429).json({
      error: `Ai atins limita zilnica de ${req.user.ai_daily_limit} cereri AI. Incearca din nou maine.`
    });
  }
  try {
    const result = await generateWithFallback(messages);
    incrementQuota(req.user.id, quota.day);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/ai/vision', requireAuth, async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'Lipsesc mesajele pentru AI.' });
  }
  const quota = checkAndReserveQuota(req.user.id, req.user.ai_daily_limit);
  if (!quota.ok) {
    return res.status(429).json({
      error: `Ai atins limita zilnica de ${req.user.ai_daily_limit} cereri AI. Incearca din nou maine.`
    });
  }
  try {
    const result = await visionTranscribe(messages);
    incrementQuota(req.user.id, quota.day);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ============================================================
// Admin
// ============================================================

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const day = todayStr();
  const users = db.prepare('SELECT id, username, role, ai_daily_limit, active, created_at FROM users ORDER BY id').all();
  const withUsage = users.map((u) => {
    const usage = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(u.id, day);
    return { ...u, aiUsedToday: usage?.count || 0 };
  });
  res.json(withUsage);
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, aiDailyLimit } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username si parola sunt obligatorii.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Exista deja un user cu acest username.' });
  }
  const hash = hashPassword(password);
  const limit = Number.isFinite(Number(aiDailyLimit)) ? Number(aiDailyLimit) : 20;
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, ai_daily_limit, active) VALUES (?, ?, ?, ?, 1)')
    .run(username, hash, 'user', limit);
  db.prepare('INSERT INTO user_data (user_id, data_json) VALUES (?, ?)').run(info.lastInsertRowid, '{}');
  res.status(201).json({ id: info.lastInsertRowid, username, role: 'user', ai_daily_limit: limit, active: 1 });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User inexistent.' });

  const { aiDailyLimit, active, password } = req.body || {};
  if (aiDailyLimit !== undefined) {
    db.prepare('UPDATE users SET ai_daily_limit = ? WHERE id = ?').run(Number(aiDailyLimit), id);
  }
  if (active !== undefined) {
    if (target.role === 'admin' && !active) {
      return res.status(400).json({ error: 'Nu poti dezactiva contul de admin.' });
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User inexistent.' });
  if (target.role === 'admin') {
    return res.status(400).json({ error: 'Nu poti sterge contul de admin.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Fit by Chezan (multi-user) rulează pe http://localhost:${PORT}`);
});
