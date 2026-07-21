# ❤️ OAuth setup — social login for luv.pythai.net

The doorway's login is **self-hosted server-side OAuth** (passport, stateless JWT session
cookie — httpOnly/secure/sameSite=lax). A provider goes live the moment BOTH its
`*_CLIENT_ID` and `*_CLIENT_SECRET` are set in the env file and the service restarts —
`/auth/providers` and the login modal pick it up automatically. No frontend changes needed.

- **Env file (VPS):** `/home/luv/DeltaVerse/deploy/web2/luv.env` (owner `luv`, chmod 0600)
- **Apply:** `systemctl restart luv.service`
- **Verify:** `curl https://luv.pythai.net/auth/providers` and
  `curl -I https://luv.pythai.net/auth/<provider>` (expect a 302 to the provider)
- **Callback URL pattern (register EXACTLY, https, no trailing slash):**
  `https://luv.pythai.net/auth/<provider>/callback`
- Shared branding: name **SHAMBA LUV**, homepage **https://luv.pythai.net**,
  logo `gfx/logo-512-transparent.png` (the gold binary-heart coin).

Status: **google ✓ live · github ✓ live** (2026-07-21) · discord wired, needs keys ·
facebook / linkedin / x / apple: expansion (strategy stubs — see §7).

---

## 1. Google ✓ (completed 2026-07-21)

Console: https://console.cloud.google.com — project `shamba-luv` (51129539128).

1. **Project**: project picker → New project → `shamba-luv`.
2. **Consent screen**: menu → **Google Auth Platform** → Get started wizard:
   app name `SHAMBA LUV`, support email, Audience **External**, contact email → Create.
3. **Branding** (optional): home page `https://luv.pythai.net`, authorized domain
   `pythai.net`. ⚠ **Skip the logo upload** unless you want Google's verification review
   (needs a privacy-policy URL, takes days–weeks). Login works without it.
4. **Client**: **Clients → Create client** → type **Web application**, name
   `luv.pythai.net`, JavaScript origin `https://luv.pythai.net`, redirect URI
   `https://luv.pythai.net/auth/google/callback` → Create → copy Client ID
   (`…apps.googleusercontent.com`) + Client secret (`GOCSPX-…`, fully visible only here).
5. **Publish** (required): **Audience → Publish app** → confirm. In *Testing* mode only
   the owner + listed test users can sign in. Our scopes (`profile email`) are
   non-sensitive — publishing needs **no** verification review.
6. Env: `GOOGLE_CLIENT_ID=` + `GOOGLE_CLIENT_SECRET=` → restart.
   Note: a freshly created client can 401 `invalid_client` for a few minutes.

## 2. GitHub ✓ (completed 2026-07-21)

Console: https://github.com/organizations/SHAMBA-LUV/settings/applications
(org-owned; personal fallback: https://github.com/settings/developers).

1. **New OAuth App**: name `SHAMBA LUV`, homepage `https://luv.pythai.net`,
   Authorization callback URL `https://luv.pythai.net/auth/github/callback`
   (GitHub allows exactly one). **Leave "Enable Device Flow" unchecked** — that's for
   browserless devices; our flow is the standard web authorization-code flow.
2. Copy Client ID → **Generate a new client secret** → copy it (shown once).
3. Env: `GITHUB_CLIENT_ID=` + `GITHUB_CLIENT_SECRET=` → restart.
   Scopes (`read:user user:email`) are requested at runtime — nothing to configure.

## 3. Discord (wired in code — add keys whenever)

Console: https://discord.com/developers/applications

1. **New Application** → `SHAMBA LUV` (App Icon: the coin, optional — no review).
2. **OAuth2** tab → **Redirects** → add
   `https://luv.pythai.net/auth/discord/callback` → Save Changes.
3. Same page: copy **Client ID**; click **Reset Secret** → copy the **Client Secret**.
4. Env: `DISCORD_CLIENT_ID=` + `DISCORD_CLIENT_SECRET=` → restart.
   Scopes at runtime: `identify email`. No publishing/verification step exists.

---

## Expansion providers (after Google + GitHub prove out)

These need BOTH a console app **and** a passport strategy in
`auth/src/auth/strategies.js` (stubs/TODOs are in that file; config slots for `apple`
and `x` already exist in `config.js` — add `facebook`/`linkedin` alongside).

## 4. Facebook

Console: https://developers.facebook.com/apps

1. **Create App** → use case **Authenticate and request data from users with Facebook
   Login** → type Consumer → name `SHAMBA LUV`.
2. Add product **Facebook Login** → Settings → **Valid OAuth Redirect URIs**:
   `https://luv.pythai.net/auth/facebook/callback`. Keep Client OAuth Login + Web OAuth
   Login ON; leave deprecated embedded flows OFF.
3. App settings → Basic: App Domains `pythai.net`, privacy-policy URL (required to go
   live), copy **App ID** / **App Secret**.
4. Switch the app from Development to **Live** (top toggle) — in Development only app
   roles can log in. `email` + `public_profile` need no App Review.
5. Env: `FACEBOOK_CLIENT_ID=` + `FACEBOOK_CLIENT_SECRET=`; implement the strategy
   (`passport-facebook`, scope `['email']`, profileFields `['id','emails','name']`).

## 5. LinkedIn

Console: https://developer.linkedin.com → My apps

1. **Create app**: name `SHAMBA LUV`, associate your LinkedIn company page, logo.
2. **Products**: request **Sign In with LinkedIn using OpenID Connect** (instant
   self-serve approval).
3. **Auth** tab: add redirect URL `https://luv.pythai.net/auth/linkedin/callback`;
   copy **Client ID** / **Primary Client Secret**.
4. Env: `LINKEDIN_CLIENT_ID=` + `LINKEDIN_CLIENT_SECRET=`; implement the strategy —
   modern LinkedIn is plain OIDC: scopes `openid profile email`, userinfo at
   `https://api.linkedin.com/v2/userinfo` (the legacy r_liteprofile packages are dead).

## 6. X (Twitter)

Console: https://developer.x.com/en/portal/dashboard (needs a developer account; the
Free tier covers login).

1. Create a **Project + App** `SHAMBA LUV` → App settings → **User authentication
   set-up**: App permissions **Read**, Type of App **Web App** (confidential client),
   Callback URI `https://luv.pythai.net/auth/x/callback`, Website
   `https://luv.pythai.net`.
2. Copy the **OAuth 2.0 Client ID and Client Secret** (NOT the v1.1 API key pair).
3. Env: `X_CLIENT_ID=` + `X_CLIENT_SECRET=` (config slots already exist); implement the
   strategy — X is OAuth2 **with PKCE required**, scopes `users.read tweet.read`.
   ⚠ X does not return an email address; our identity model allows `email = null`.

## 7. Wiring a new strategy (the 15-line recipe)

In `auth/src/auth/strategies.js` copy the GitHub block: require the provider strategy,
`passport.use(new Strategy({ clientID, clientSecret, callbackURL:
`${config.publicBaseUrl}/auth/<provider>/callback`, scope }, verify))` normalizing to
`{ provider, providerUserId, email }`. In `auth/src/routes/auth.js` add
`wireProvider('<provider>', [scopes])` under the ENABLED check, and extend
`enabledProviders()` in `config.js`. The frontend needs nothing — buttons render from
`/auth/providers` (labels in `luv.app.js` `PROVIDER_LABEL`).

---

## Key handling rules

- Live secrets exist in exactly TWO places: the VPS env file (0600, outside the git
  tree and the web root) and the operator's local store
  (`~/incentivedistributor2/.credentials/luv-oauth.env`, git-ignored). Never in git,
  never in the frontend — the browser only ever sees the public client_id in the
  provider redirect.
- Rotate a leaked secret in the provider console, update BOTH copies, restart.
