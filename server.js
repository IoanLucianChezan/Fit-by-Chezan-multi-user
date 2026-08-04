require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { one, all, run, todayStr, initDb } = require('./db');
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

// scapa de try/catch repetitiv in fiecare ruta async - orice eroare ajunge la error handler-ul de la final
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.use(express.json({ limit: '15mb' })); // poze base64 la transcriere pot fi mari
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Auth
// ============================================================

app.post(
  '/api/auth/login',
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username si parola sunt obligatorii.' });
    }
    const user = await one('SELECT * FROM users WHERE username = $1', [username]);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Username sau parola gresita.' });
    }
    const token = signToken(user);
    setSessionCookie(res, token);
    res.json({ username: user.username, role: user.role });
  })
);

app.post(
  '/api/auth/register',
  ah(async (req, res) => {
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
    const existing = await one('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) {
      return res.status(409).json({ error: 'Exista deja un cont cu acest username.' });
    }
    const defaultLimit = Number(process.env.DEFAULT_USER_AI_LIMIT) || 5;
    const hash = hashPassword(password);
    const created = await one(
      'INSERT INTO users (username, password_hash, role, ai_daily_limit, active) VALUES ($1, $2, $3, $4, true) RETURNING id',
      [username, hash, 'user', defaultLimit]
    );
    await run('INSERT INTO user_data (user_id, data_json) VALUES ($1, $2)', [created.id, '{}']);

    const token = signToken({ id: created.id, username, role: 'user' });
    setSessionCookie(res, token);
    res.status(201).json({ username, role: 'user' });
  })
);

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get(
  '/api/auth/me',
  requireAuth,
  ah(async (req, res) => {
    const day = todayStr();
    const usage = await one('SELECT count FROM ai_usage WHERE user_id = $1 AND day = $2', [req.user.id, day]);
    res.json({
      username: req.user.username,
      role: req.user.role,
      aiDailyLimit: req.user.ai_daily_limit,
      aiUsedToday: usage?.count || 0
    });
  })
);

app.post(
  '/api/auth/change-password',
  requireAuth,
  ah(async (req, res) => {
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
    await run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), req.user.id]);
    res.json({ ok: true });
  })
);

// ============================================================
// Date utilizator (inlocuieste localStorage)
// ============================================================

app.get(
  '/api/data',
  requireAuth,
  ah(async (req, res) => {
    const row = await one('SELECT data_json FROM user_data WHERE user_id = $1', [req.user.id]);
    res.json(row ? JSON.parse(row.data_json) : {});
  })
);

app.put(
  '/api/data',
  requireAuth,
  ah(async (req, res) => {
    const json = JSON.stringify(req.body || {});
    const existing = await one('SELECT user_id FROM user_data WHERE user_id = $1', [req.user.id]);
    if (existing) {
      await run('UPDATE user_data SET data_json = $1, updated_at = now() WHERE user_id = $2', [json, req.user.id]);
    } else {
      await run('INSERT INTO user_data (user_id, data_json) VALUES ($1, $2)', [req.user.id, json]);
    }
    res.json({ ok: true });
  })
);

// ============================================================
// AI (proxy server-side, cu limita zilnica per user)
// ============================================================

async function checkAndReserveQuota(userId, limit) {
  const day = todayStr();
  const row = await one('SELECT count FROM ai_usage WHERE user_id = $1 AND day = $2', [userId, day]);
  const used = row?.count || 0;
  if (used >= limit) return { ok: false, used };
  return { ok: true, used, day };
}

async function incrementQuota(userId, day) {
  const existing = await one('SELECT count FROM ai_usage WHERE user_id = $1 AND day = $2', [userId, day]);
  if (existing) {
    await run('UPDATE ai_usage SET count = count + 1 WHERE user_id = $1 AND day = $2', [userId, day]);
  } else {
    await run('INSERT INTO ai_usage (user_id, day, count) VALUES ($1, $2, 1)', [userId, day]);
  }
}

app.post(
  '/api/ai/chat',
  requireAuth,
  ah(async (req, res) => {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'Lipsesc mesajele pentru AI.' });
    }
    const quota = await checkAndReserveQuota(req.user.id, req.user.ai_daily_limit);
    if (!quota.ok) {
      return res.status(429).json({
        error: `Ai atins limita zilnica de ${req.user.ai_daily_limit} cereri AI. Incearca din nou maine.`
      });
    }
    try {
      const result = await generateWithFallback(messages);
      await incrementQuota(req.user.id, quota.day);
      res.json({ content: result.content });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  })
);

app.post(
  '/api/ai/vision',
  requireAuth,
  ah(async (req, res) => {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'Lipsesc mesajele pentru AI.' });
    }
    const quota = await checkAndReserveQuota(req.user.id, req.user.ai_daily_limit);
    if (!quota.ok) {
      return res.status(429).json({
        error: `Ai atins limita zilnica de ${req.user.ai_daily_limit} cereri AI. Incearca din nou maine.`
      });
    }
    try {
      const result = await visionTranscribe(messages);
      await incrementQuota(req.user.id, quota.day);
      res.json({ content: result.content });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  })
);

// ============================================================
// Admin
// ============================================================

app.get(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const day = todayStr();
    const users = await all('SELECT id, username, role, ai_daily_limit, active, created_at FROM users ORDER BY id');
    const withUsage = await Promise.all(
      users.map(async (u) => {
        const usage = await one('SELECT count FROM ai_usage WHERE user_id = $1 AND day = $2', [u.id, day]);
        return { ...u, aiUsedToday: usage?.count || 0 };
      })
    );
    res.json(withUsage);
  })
);

app.get(
  '/api/admin/users/:id/usage',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const days = Math.min(Number(req.query.days) || 30, 90);
    const target = await one('SELECT id, username FROM users WHERE id = $1', [id]);
    if (!target) return res.status(404).json({ error: 'User inexistent.' });

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = await all('SELECT day, count FROM ai_usage WHERE user_id = $1 AND day >= $2 ORDER BY day DESC', [
      id,
      sinceStr
    ]);

    // completeaza zilele fara nicio cerere cu count 0, ca sa fie un istoric continuu
    const byDay = new Map(rows.map((r) => [r.day, r.count]));
    const history = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      history.push({ day: dayStr, count: byDay.get(dayStr) || 0 });
    }
    res.json({ username: target.username, history });
  })
);

app.post(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const { username, password, aiDailyLimit } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username si parola sunt obligatorii.' });
    }
    const existing = await one('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) {
      return res.status(409).json({ error: 'Exista deja un user cu acest username.' });
    }
    const hash = hashPassword(password);
    const limit = Number.isFinite(Number(aiDailyLimit)) ? Number(aiDailyLimit) : 20;
    const created = await one(
      'INSERT INTO users (username, password_hash, role, ai_daily_limit, active) VALUES ($1, $2, $3, $4, true) RETURNING id',
      [username, hash, 'user', limit]
    );
    await run('INSERT INTO user_data (user_id, data_json) VALUES ($1, $2)', [created.id, '{}']);
    res.status(201).json({ id: created.id, username, role: 'user', ai_daily_limit: limit, active: true });
  })
);

app.patch(
  '/api/admin/users/:id',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const target = await one('SELECT * FROM users WHERE id = $1', [id]);
    if (!target) return res.status(404).json({ error: 'User inexistent.' });

    const { aiDailyLimit, active, password } = req.body || {};
    if (aiDailyLimit !== undefined) {
      await run('UPDATE users SET ai_daily_limit = $1 WHERE id = $2', [Number(aiDailyLimit), id]);
    }
    if (active !== undefined) {
      if (target.role === 'admin' && !active) {
        return res.status(400).json({ error: 'Nu poti dezactiva contul de admin.' });
      }
      await run('UPDATE users SET active = $1 WHERE id = $2', [Boolean(active), id]);
    }
    if (password) {
      await run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), id]);
    }
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/users/:id',
  requireAuth,
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const target = await one('SELECT * FROM users WHERE id = $1', [id]);
    if (!target) return res.status(404).json({ error: 'User inexistent.' });
    if (target.role === 'admin') {
      return res.status(400).json({ error: 'Nu poti sterge contul de admin.' });
    }
    await run('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Eroare de server.' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Fit by Chezan (multi-user) rulează pe http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Nu am putut initializa baza de date:', err);
    process.exit(1);
  });
