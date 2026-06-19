'use strict';

/*
 * strategies.js — passport OAuth strategies.
 *
 * Concretely wired: Google, Discord, GitHub.
 * Stubbed (pluggable): Apple, X (Twitter) — see TODOs below.
 *
 * Each strategy's verify callback normalizes the provider profile into:
 *   { provider, providerUserId, email }
 * and hands it to passport's `done`. We DO NOT run provisioning here — that happens in the
 * callback route after the JWT identity is established, so the flow is auditable in one place.
 *
 * We use passport in stateless mode (no server session store): the verify result is carried
 * through the request and turned into a signed JWT by the callback route.
 */

const passport = require('passport');
const { config, enabledProviders } = require('../config');

function normalizeProfile(provider, profile, extraEmail) {
  const email =
    extraEmail ||
    (profile.emails && profile.emails[0] && profile.emails[0].value) ||
    (profile._json && profile._json.email) ||
    null;
  return {
    provider,
    providerUserId: String(profile.id),
    email,
  };
}

function register() {
  const enabled = enabledProviders();

  // ----- Google -----
  if (enabled.includes('google')) {
    // eslint-disable-next-line global-require
    const GoogleStrategy = require('passport-google-oauth20').Strategy;
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.oauth.google.clientId,
          clientSecret: config.oauth.google.clientSecret,
          callbackURL: `${config.publicBaseUrl}/auth/google/callback`,
          scope: ['profile', 'email'],
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            done(null, normalizeProfile('google', profile));
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  // ----- Discord -----
  if (enabled.includes('discord')) {
    // eslint-disable-next-line global-require
    const DiscordStrategy = require('passport-discord').Strategy;
    passport.use(
      new DiscordStrategy(
        {
          clientID: config.oauth.discord.clientId,
          clientSecret: config.oauth.discord.clientSecret,
          callbackURL: `${config.publicBaseUrl}/auth/discord/callback`,
          scope: ['identify', 'email'],
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            done(null, normalizeProfile('discord', profile, profile.email));
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  // ----- GitHub -----
  if (enabled.includes('github')) {
    // eslint-disable-next-line global-require
    const GitHubStrategy = require('passport-github2').Strategy;
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.oauth.github.clientId,
          clientSecret: config.oauth.github.clientSecret,
          callbackURL: `${config.publicBaseUrl}/auth/github/callback`,
          scope: ['read:user', 'user:email'],
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            done(null, normalizeProfile('github', profile));
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  // ----- Apple (TODO: pluggable) -----
  // Apple Sign In uses a JWT client secret (signed with APPLE_PRIVATE_KEY/keyId/teamId) and
  // returns the user id in the id_token `sub`. To enable:
  //   const AppleStrategy = require('passport-apple');
  //   passport.use(new AppleStrategy({ clientID, teamID, keyID, privateKeyString,
  //     callbackURL: `${config.publicBaseUrl}/auth/apple/callback`, scope: ['name','email'] },
  //     (accessToken, refreshToken, idToken, profile, done) =>
  //       done(null, { provider: 'apple', providerUserId: idToken.sub, email: idToken.email })));
  // Then add deps `passport-apple` + the Apple env vars in config.oauth.apple.

  // ----- X / Twitter (TODO: pluggable) -----
  // X uses OAuth2 (PKCE). To enable:
  //   const XStrategy = require('@superfaceai/passport-twitter-oauth2').Strategy; // or similar
  //   passport.use(new XStrategy({ clientID, clientSecret, clientType: 'confidential',
  //     callbackURL: `${config.publicBaseUrl}/auth/x/callback`, scope: ['users.read','tweet.read'] },
  //     (accessToken, refreshToken, profile, done) =>
  //       done(null, normalizeProfile('x', profile))));

  // Stateless: serialize/deserialize are no-ops (we don't use server sessions, we mint a JWT).
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  return enabled;
}

module.exports = { register, normalizeProfile };
