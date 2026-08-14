import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "api/_lib/handler.ts");
const outfile = path.join(root, "api/typing-feedback.cjs");

const result = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild@0.25.8",
    entry,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--banner:js=/* generated from api/_lib/handler.ts — run node scripts/bundle-api.mjs */",
    "--footer:js=if (typeof module.exports.default === 'function') { module.exports = module.exports.default; }",
    `--outfile=${outfile}`,
  ],
  {
    stdio: "inherit",
    cwd: "/tmp",
    env: { ...process.env, NPM_CONFIG_ENGINE_STRICT: "false" },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
