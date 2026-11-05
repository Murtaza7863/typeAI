import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const logFolderPath = process.env["LOG_FOLDER_PATH"] ?? "./logs";
mkdirSync(resolve(logFolderPath), { recursive: true });
