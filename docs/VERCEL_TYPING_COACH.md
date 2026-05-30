# Typing coach on Vercel

The hosted site calls **`POST /api/typing-feedback`** on the same domain (Vercel serverless function). It does **not** use `api.typeai.com/dev/typingFeedback`.

## Required: API key in Vercel

Project → **Settings** → **Environment Variables** (Production):

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | **Recommended** — fast AI coach (~5–15s). Works on Vercel free tier. |
| `CURSOR_API_KEY` | Fallback — Cursor agent (slow, 30–60s; may hit Vercel timeout on free plan) |
| `LITE_MODE` | `true` — stripped UI |
| `BACKEND_URL` | `https://api.typeai.com` |
| `RECAPTCHA_SITE_KEY` | test key or your site key |

Optional: `LLM_MODEL` (default `gpt-4o-mini`), `TYPING_FEEDBACK_MIN_TESTS` (default `3`).

## After changing env vars

**Redeploy** with **Clear build cache**.

## Verify

1. Complete 3+ tests (guest / localStorage).
2. Open result screen → Typing coach.
3. Network tab should show `POST /api/typing-feedback` (not `api.typeai.com/dev/...`).

If AI times out, you still get rule-based feedback (no error).
