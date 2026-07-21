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
3. Network tab should show `POST /api/typing-feedback` (not `api.typeai.com/dev/...`).
4. With `FIREBASE_CONFIG` set: open **Login** → sign in → **Account** should load your stats.

If AI times out, you still get rule-based feedback (no error).

## Competitive races on Vercel

When `BACKEND_URL` points at `api.typeai.com` (no `/race-ws`), race parties use browser peer-to-peer (PeerJS). Self-hosted backends that expose `/race-ws` still use WebSockets.
