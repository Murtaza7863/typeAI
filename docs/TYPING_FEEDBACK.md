# Launch Monkeytype (fixed setup)

## What was wrong

1. **Node.js was not installed** — `node` / `pnpm` were missing from your PATH  
2. **Dependencies never installed** — no `node_modules`  
3. **MongoDB & Redis were not running** — installed via Homebrew and started as services  
4. **Missing `firebase-config.ts`** — required for the frontend to load  
5. **TypeScript errors** in the typing-feedback code — fixed  

## One-command start (after first-time setup below)

```bash
cd ~/Downloads/monkeytype-master
./scripts/dev.sh
```

Open **http://localhost:3000**

Add this to `~/.zshrc` so `node` works in every terminal:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"
```

Then run `source ~/.zshrc`.

## First-time setup (already done on your machine)

- `brew install node@24 redis mongodb-community@7.0`
- `brew services start redis`
- `brew services start mongodb/brew/mongodb-community@7.0`
- `pnpm install` in the repo

## API key (`backend/.env`)

```env
CURSOR_API_KEY=crsr_...   # from cursor.com/dashboard/integrations
TYPING_FEEDBACK_MIN_TESTS=5   # lowered for local testing
```

**Security:** If this key was ever shared or committed, rotate it in the Cursor dashboard.

## Firebase (required to sign in & save tests)

1. [Firebase Console](https://console.firebase.google.com/) → your project → Project settings → Web app  
2. Paste values into `frontend/src/ts/constants/firebase-config.ts`  
3. Backend: download **service account JSON** →  
   `backend/src/credentials/serviceAccountKey.json`  
   (Without this, login/saving results will fail even if the site loads.)

## Manual start (two terminals)

**Terminal 1 — databases** (if not already running):

```bash
brew services start redis
brew services start mongodb/brew/mongodb-community@7.0
```

**Terminal 2 — app:**

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
cd ~/Downloads/monkeytype-master
HUSKY=0 pnpm run dev
```

- Frontend: http://localhost:3000  
- Backend: http://localhost:5005  

## Typing coach (no sign-in required)

- Each finished test is saved in **browser localStorage**
- After **3+** tests on this device, the **Typing coach** panel appears on the result screen
- Uses `POST /dev/typingFeedback` + your `CURSOR_API_KEY` for AI (dev mode only)
- Sign in later to sync history to your account

## Typing coach (signed in)

- Uses server-side history from your account  
- Rule-based feedback works without AI  
- With `CURSOR_API_KEY`, first AI refresh can take 1–2 minutes  

## Still broken?

| Symptom | Fix |
|---------|-----|
| `command not found: node` | Add Homebrew Node to PATH (see above) |
| `command not found: pnpm` | `corepack enable` after Node is on PATH |
| Blank page / Firebase errors | Fill in `firebase-config.ts` |
| Can't sign in / save results | Add `serviceAccountKey.json` on backend |
| Coach never shows AI | Check backend logs; confirm `CURSOR_API_KEY` in `.env` and restart dev server |
