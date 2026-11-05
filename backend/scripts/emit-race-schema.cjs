const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const schemaRoot = path.resolve(__dirname, "../../packages/schemas");
const sourcePath = path.join(schemaRoot, "src/race.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const emitted = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
});

const outDir = path.join(schemaRoot, "dist");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "race.js"), emitted.outputText);
