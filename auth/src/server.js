'use strict';

/*
 * server.js — Express app: helmet, STRICT CORS, sane rate limits, JSON body limit, JWT sessions,
 * passport, routes, /health.
 *
 * Security posture (fixes vs. the old dataluv/luvdat backend):
 *   - auth required on every state-changing route (see routes/airdrop.js requireAuth)
 *   - req.ip is the real client IP (trust proxy configured), never read from the body
 *   - CORS is an exact-origin allowlist — no substring match, no `!origin` bypass
 *   - rate limits are sane and tighter on auth/claim
 *   - IP_SALT is required from env (no hardcoded fallback) — see config.js
 *   - no PII (raw IPs / full request bodies) in logs
 *   - all SQL parameterized; secrets only from env
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const passport = require('passport');

const { config } = require('./config');
const { register: registerStrategies } = require('./auth/strategies');
const authRoutes = require('./routes/auth');
const airdropRoutes = require('./routes/airdrop');

function createApp() {
  const app = express();

  // Real client IP behind a proxy/load balancer. Configurable via TRUST_PROXY
  // (e.g. "1", "loopback", "uniquelocal"). Default 1 hop. NEVER trust the body for IP.
  app.set('trust proxy', process.env.TRUST_PROXY || 1);

  app.use(helmet());
  app.use(cookieParser());

  // STRICT CORS: only origins explicitly in the allowlist are permitted. No substring match,
  // no `origin === undefined` (curl / same-origin) auto-allow for credentialed routes.
  const allowlist = new Set(config.corsAllowlist);
  app.use(
    cors({
      origin(origin, cb) {
        // Browser cross-origin requests always send an Origin header. Requests with no Origin
        // (same-origin, server-to-server) are not granted CORS headers but are not blocked at
        // the network layer; they simply receive no ACAO. We only echo allowlisted origins.
        if (!origin) return cb(null, false);
        if (allowlist.has(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
    })
  );

  // JSON body with a tight limit (no giant payloads).
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  // Passport (stateless — no server session store; we mint JWTs).
  registerStrategies();
  app.use(passport.initialize());

  // ---- Rate limiters ----
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    // keyGenerator uses req.ip (real client IP via trust proxy). No raw IP is logged.
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // tighter on the OAuth + login surface
    standardHeaders: true,
    legacyHeaders: false,
  });
  const claimLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // tightest on the airdrop trigger
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(generalLimiter);

  // ---- Health (no auth, no PII) ----
  app.get('/health', (req, res) => {
    res.json({ ok: true, env: config.env });
  });

  // ---- Routes ----
  app.use('/auth', authLimiter, authRoutes);
  app.use('/airdrop', claimLimiter, airdropRoutes);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  // Error handler — never leak stack traces / PII.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[server] error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

function start() {
  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[shambaluv-auth] listening on :${config.port} (${config.env})`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
