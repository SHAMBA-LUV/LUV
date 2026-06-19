'use strict';

/*
 * session.js — signed JWT sessions (stateless). We use a signed JWT in an httpOnly cookie
 * (and accept it as a Bearer token for API clients / Tauri). The JWT carries only the
 * identity key + provider — no PII beyond that.
 */

const jwt = require('jsonwebtoken');
const { config } = require('../config');

const COOKIE_NAME = 'shambaluv_session';

function issueToken(identity) {
  // identity: { identityKey, provider }
  return jwt.sign(
    { sub: identity.identityKey, provider: identity.provider },
    config.jwtSecret,
    { expiresIn: config.jwtTtlSeconds, issuer: 'shambaluv-auth' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'shambaluv-auth' });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.jwtTtlSeconds * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Express middleware: require a valid JWT session (cookie OR Authorization: Bearer).
// This is the fix for the old backend which had NO auth on state-changing routes.
function requireAuth(req, res, next) {
  let token = null;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (req.cookies && req.cookies[COOKIE_NAME]) token = req.cookies[COOKIE_NAME];

  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const payload = verifyToken(token);
    req.identity = { identityKey: payload.sub, provider: payload.provider };
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'invalid_session' });
  }
}

module.exports = {
  COOKIE_NAME,
  issueToken,
  verifyToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
};
