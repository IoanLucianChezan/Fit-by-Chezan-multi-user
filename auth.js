const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { one } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET lipseste din .env - genereaza unul (ex: openssl rand -hex 32) si adauga-l in .env');
}
const COOKIE_NAME = 'fwc_session';
const TOKEN_TTL = '30d';

const PASSWORD_RULE_MESSAGE = 'Parola trebuie sa aiba minim 6 caractere, cu cel putin o litera si o cifra.';

function isPasswordValid(password) {
  return typeof password === 'string' && /^(?=.*[a-zA-Z])(?=.*\d).{6,}$/.test(password);
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_TTL
  });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Neautentificat.' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Sesiune invalida sau expirata.' });
  }
  try {
    const user = await one('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Cont inexistent sau dezactivat.' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acces permis doar administratorului.' });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  isPasswordValid,
  PASSWORD_RULE_MESSAGE,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  COOKIE_NAME
};
