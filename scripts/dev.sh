#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install with: brew install node@24"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! redis-cli ping >/dev/null 2>&1; then
  echo "Starting Redis..."
  brew services start redis 2>/dev/null || true
fi

if ! mongosh --eval "db.runCommand({ ping: 1 })" --quiet >/dev/null 2>&1; then
  echo "Starting MongoDB..."
  brew services start mongodb/brew/mongodb-community@7.0 2>/dev/null || true
  sleep 2
fi

if [[ ! -f frontend/src/ts/constants/firebase-config.ts ]]; then
  cp frontend/src/ts/constants/firebase-config-example.ts frontend/src/ts/constants/firebase-config.ts
  echo "Created firebase-config.ts — add your Firebase keys to sign in."
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  HUSKY=0 pnpm install
fi

echo "Starting Monkeytype (http://localhost:3000)..."
HUSKY=0 pnpm run dev
