# Typing coach on Vercel

The hosted site calls **`POST /api/typing-feedback`** on the same domain (Vercel serverless function). It does **not** use `api.typeai.com/dev/typingFeedback`.

## Required: API key in Vercel

Project → **Settings** → **Environment Variables** (Production):

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | **Recommended** — fast AI coach (~5–15s). Works on Vercel free tier. |
| `CURSOR_API_KEY` | Fallback — Cursor agent (slow, 30–60s; may hit Vercel timeout on free plan) |
| `LITE_MODE` | `true` — lighter UI (account/login/race/settings still available) |
| `BACKEND_URL` | `https://api.typeai.com` |
| `RACE_WS_URL` | Optional. Production already uses `wss://typeai-race.onrender.com/race-ws`. Set this only to point at a different race server. |
| `RECAPTCHA_SITE_KEY` | test key or your site key |
| `FIREBASE_CONFIG` | **Required for account/login** — JSON string of your Firebase web app config |

### `FIREBASE_CONFIG` example

Paste as one line (Production + Preview):

```json
{"apiKey":"...","authDomain":"your-app.firebaseapp.com","projectId":"your-app","storageBucket":"your-app.appspot.com","messagingSenderId":"...","appId":"..."}
```

Without this (or a local `firebase-config.ts` / `firebase-config-live.ts`), `/account` and `/login` cannot work — the app will show a notice and return home.

Optional: `LLM_MODEL` (default `gpt-4o-mini`), `TYPING_FEEDBACK_MIN_TESTS` (default `3`).

## After changing env vars

**Redeploy** with **Clear build cache**.

## Verify

1. Complete 3+ tests (guest / localStorage).
2. Open result screen → Typing coach.
3. Network tab should show `POST https://<render-host>/typing-feedback` after 3 saved tests. Rule-based text appears even if that request fails.
4. With `FIREBASE_CONFIG` set: open **Login** → sign in → **Account** should load your stats.

If AI times out, you still get rule-based feedback (no error).

## Typing coach

Guest feedback is built in the browser. After 3 saved tests, the result screen also asks the Render server for an AI summary at `POST /typing-feedback`. That URL comes from `RACE_WS_URL`. Put `OPENAI_API_KEY` on the Render service, not on Vercel. If Render is asleep, errors, or has no key, the rule-based feedback still shows.

## Today's board

`/daily` and the result screen post a nickname plus that test to Render `POST /daily-board`. Scores live in Upstash Redis for the UTC day. On the Render service set:

| Variable | Purpose |
|----------|---------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |

Without those, the board says it is not connected. Login stays off, so names are not verified.

## Competitive races

Live races use the Render service in `render.yaml` (`typeai-race`). It is a long-running process with a WebSocket at `/race-ws`. A production frontend build connects there even when `RACE_WS_URL` is unset. Vercel’s `/api/race-room` lobby can start a race, but finish updates get overwritten, so that path often never completes.

1. Deploy the blueprint on Render. Invite links use the site the host opened (`*.vercel.app`, localhost, or `FRONTEND_URL`).
2. Redeploy the frontend so the race server URL is baked into the bundle. Set `RACE_WS_URL` only if the Render host is not `typeai-race`.
4. Optional: `OPENAI_API_KEY` and the two Upstash variables on Render, then redeploy Render.

Accounts stay off (`ACCOUNTS_ENABLED` is false). A GitHub Action pings `/health` every 10 minutes. If the free instance still sleeps, the first join can take up to a minute.
