const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.resolve(__dirname, "../../api/_lib/typing-coach.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const emitted = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
});

const outDir = path.resolve(__dirname, "../dist/race");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "typing-coach.js"), emitted.outputText);
