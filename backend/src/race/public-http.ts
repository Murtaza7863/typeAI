import { randomBytes } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { allowedFrontendOrigin } from "./frontend-origin";

const loadModule = createRequire(__filename);

export type DailyEntry = {
  nickname: string;
  wpm: number;
  acc: number;
  mode: string;
  mode2: string;
};

type RedisCaller = (command: (string | number)[]) => Promise<unknown>;
type CoachCaller = (sessions: unknown[]) => Promise<unknown>;

const NICKNAME = /^[A-Za-z0-9]{2,16}$/;
const HOUR_MS = 60 * 60 * 1000;
const POST_LIMIT = 10;
const COACH_TIMEOUT_MS = 18_000;

const postsByIp = new Map<string, number[]>();
let redisOverride: RedisCaller | undefined;
let coachOverride: CoachCaller | undefined;

export function setRedisForTests(caller: RedisCaller | undefined): void {
  redisOverride = caller;
}

export function setTypingCoachForTests(caller: CoachCaller | undefined): void {
  coachOverride = caller;
}

export function resetPublicHttpForTests(): void {
  postsByIp.clear();
  redisOverride = undefined;
  coachOverride = undefined;
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = allowedFrontendOrigin(
    typeof req.headers.origin === "string" ? req.headers.origin : undefined,
  );
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Client-Version",
    Vary: "Origin",
  };
  if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first === "") return "unknown";
    return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

async function allowPost(ip: string): Promise<boolean> {
  if (redisConfigured()) {
    const key = `typeai:daily:rate:${ip}`;
    const count = Number(await redis(["INCR", key]));
    if (count === 1) await redis(["EXPIRE", key, Math.floor(HOUR_MS / 1000)]);
    return Number.isFinite(count) && count <= POST_LIMIT;
  }
  const now = Date.now();
  const recent = (postsByIp.get(ip) ?? []).filter(
    (time) => time > now - HOUR_MS,
  );
  if (recent.length >= POST_LIMIT) {
    postsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  postsByIp.set(ip, recent);
  return true;
}

function chunkBytes(chunk: unknown): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (Buffer.isBuffer(chunk)) return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.alloc(0);
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunkBytes(chunk);
    size += buf.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as unknown;
}

function redisConfigured(): boolean {
  if (redisOverride !== undefined) return true;
  const url = process.env["UPSTASH_REDIS_REST_URL"] ?? "";
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"] ?? "";
  return url !== "" && token !== "";
}

async function redis(command: (string | number)[]): Promise<unknown> {
  if (redisOverride !== undefined) return redisOverride(command);
  const url = process.env["UPSTASH_REDIS_REST_URL"] ?? "";
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"] ?? "";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = (await response.json()) as {
    result?: unknown;
    error?: string;
  };
  if (!response.ok || payload.error !== undefined) {
    throw new Error(payload.error ?? "redis error");
  }
  return payload.result;
}

function dailyKeys(now = new Date()): {
  board: string;
  meta: string;
  claims: string;
  expireAt: number;
} {
  const day = now.toISOString().slice(0, 10);
  const expireAt = Math.floor(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      12,
    ) / 1000,
  );
  return {
    board: `typeai:daily:${day}`,
    meta: `typeai:daily:${day}:meta`,
    claims: `typeai:daily:${day}:claim`,
    expireAt,
  };
}

export function parseDailyPost(
  body: unknown,
):
  | { ok: true; entry: DailyEntry; token?: string }
  | { ok: false; message: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, message: "Invalid body" };
  }
  const record = body as Record<string, unknown>;
  const nickname = record["nickname"];
  const wpm = record["wpm"];
  const acc = record["acc"];
  const mode = record["mode"];
  const mode2 = record["mode2"];
  if (typeof nickname !== "string" || !NICKNAME.test(nickname)) {
    return {
      ok: false,
      message: "Nickname must be 2-16 letters or numbers",
    };
  }
  if (
    typeof wpm !== "number" ||
    !Number.isFinite(wpm) ||
    wpm < 1 ||
    wpm > 300
  ) {
    return { ok: false, message: "WPM must be between 1 and 300" };
  }
  if (
    typeof acc !== "number" ||
    !Number.isFinite(acc) ||
    acc < 0 ||
    acc > 100
  ) {
    return { ok: false, message: "Accuracy must be between 0 and 100" };
  }
  if (typeof mode !== "string" || mode.length < 1 || mode.length > 16) {
    return { ok: false, message: "Invalid mode" };
  }
  if (typeof mode2 !== "string" || mode2.length < 1 || mode2.length > 16) {
    return { ok: false, message: "Invalid mode" };
  }
  const posted = record["token"];
  const token =
    typeof posted === "string" && /^[a-f0-9]{32}$/.test(posted)
      ? posted
      : undefined;
  return { ok: true, entry: { nickname, wpm, acc, mode, mode2 }, token };
}

async function claimNickname(
  nickname: string,
  token: string | undefined,
): Promise<{ ok: true; token: string } | { ok: false }> {
  const { claims, expireAt } = dailyKeys();
  const fresh = randomBytes(16).toString("hex");
  const created = await redis(["HSETNX", claims, nickname, fresh]);
  await redis(["EXPIREAT", claims, expireAt]);
  if (created === 1 || created === "1") return { ok: true, token: fresh };
  const existing = await redis(["HGET", claims, nickname]);
  if (typeof existing === "string" && existing === token) {
    return { ok: true, token: existing };
  }
  return { ok: false };
}

function parseRange(value: unknown): [string, number][] {
  if (!Array.isArray(value)) return [];
  const list = value as unknown[];
  const pairs: [string, number][] = [];
  for (let index = 0; index < list.length; index += 2) {
    const nickname = list[index];
    const score = Number(list[index + 1]);
    if (typeof nickname === "string" && Number.isFinite(score)) {
      pairs.push([nickname, score]);
    }
  }
  return pairs;
}

function parseHash(value: unknown): Map<string, DailyEntry> {
  const entries = new Map<string, DailyEntry>();
  const pairs: [string, string][] = [];
  if (Array.isArray(value)) {
    const list = value as unknown[];
    for (let index = 0; index < list.length; index += 2) {
      const field = list[index];
      const raw = list[index + 1];
      if (typeof field === "string" && typeof raw === "string") {
        pairs.push([field, raw]);
      }
    }
  } else if (value !== null && typeof value === "object") {
    for (const [field, raw] of Object.entries(value)) {
      if (typeof raw === "string") pairs.push([field, raw]);
    }
  }
  for (const [nickname, raw] of pairs) {
    try {
      const parsed = JSON.parse(raw) as Partial<DailyEntry>;
      if (parsed.nickname !== nickname) continue;
      entries.set(nickname, {
        nickname,
        wpm: typeof parsed.wpm === "number" ? parsed.wpm : 0,
        acc: typeof parsed.acc === "number" ? parsed.acc : 0,
        mode: typeof parsed.mode === "string" ? parsed.mode : "",
        mode2: typeof parsed.mode2 === "string" ? parsed.mode2 : "",
      });
    } catch {
      continue;
    }
  }
  return entries;
}

async function readBoard(): Promise<DailyEntry[]> {
  const { board, meta } = dailyKeys();
  const range = await redis(["ZRANGE", board, 0, -1, "REV", "WITHSCORES"]);
  const details = parseHash(await redis(["HGETALL", meta]));
  return parseRange(range)
    .slice(0, 20)
    .map(([nickname, wpm]) => {
      const detail = details.get(nickname);
      return {
        nickname,
        wpm,
        acc: detail?.acc ?? 0,
        mode: detail?.mode ?? "",
        mode2: detail?.mode2 ?? "",
      };
    });
}

async function saveIfHigher(entry: DailyEntry): Promise<void> {
  const { board, meta, expireAt } = dailyKeys();
  const updated = await redis(["ZADD", board, "GT", entry.wpm, entry.nickname]);
  if (updated === 0 || updated === "0") return;
  await redis(["HSET", meta, entry.nickname, JSON.stringify(entry)]);
  await redis(["EXPIREAT", board, expireAt]);
  await redis(["EXPIREAT", meta, expireAt]);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, ms);
  });
  void work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function loadCoach(): CoachCaller {
  if (coachOverride !== undefined) return coachOverride;
  const loaded = loadModule("./typing-coach.js") as {
    getTypingFeedbackFromSessions: CoachCaller;
  };
  return async (sessions) => loaded.getTypingFeedbackFromSessions(sessions);
}

async function handleTypingFeedback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJson(req, 256_000);
  } catch {
    sendJson(req, res, 400, { message: "Invalid JSON body", data: null });
    return;
  }
  const sessions =
    body !== null &&
    typeof body === "object" &&
    Array.isArray((body as { sessions?: unknown }).sessions)
      ? (body as { sessions: unknown[] }).sessions.slice(-50)
      : null;
  if (sessions === null) {
    sendJson(req, res, 400, {
      message: "sessions array is required",
      data: null,
    });
    return;
  }
  try {
    const feedback = await withTimeout(loadCoach()(sessions), COACH_TIMEOUT_MS);
    sendJson(req, res, 200, {
      message: "Typing feedback generated",
      data: feedback,
    });
  } catch (error) {
    console.error("typing feedback failed", error);
    sendJson(req, res, 500, {
      message: "Failed to generate typing feedback",
      data: null,
    });
  }
}

async function handleDailyGet(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!redisConfigured()) {
    sendJson(req, res, 200, { configured: false, entries: [] });
    return;
  }
  try {
    sendJson(req, res, 200, {
      configured: true,
      entries: await readBoard(),
    });
  } catch (error) {
    console.error("daily board read failed", error);
    sendJson(req, res, 500, { message: "Daily board unavailable" });
  }
}

async function handleDailyPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!redisConfigured()) {
    sendJson(req, res, 503, { message: "Daily board is not configured" });
    return;
  }
  let body: unknown;
  try {
    body = await readJson(req, 4_000);
  } catch {
    sendJson(req, res, 400, { message: "Invalid JSON body" });
    return;
  }
  const parsed = parseDailyPost(body);
  if (!parsed.ok) {
    sendJson(req, res, 400, { message: parsed.message });
    return;
  }
  try {
    if (!(await allowPost(clientIp(req)))) {
      sendJson(req, res, 429, { message: "Too many scores from this network" });
      return;
    }
    const claimed = await claimNickname(parsed.entry.nickname, parsed.token);
    if (!claimed.ok) {
      sendJson(req, res, 403, {
        message: "That nickname is already taken today",
      });
      return;
    }
    await saveIfHigher(parsed.entry);
    sendJson(req, res, 200, {
      configured: true,
      entries: await readBoard(),
      token: claimed.token,
    });
  } catch (error) {
    console.error("daily board write failed", error);
    sendJson(req, res, 500, { message: "Could not save score" });
  }
}

export async function handlePublicHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      sendJson(req, res, 200, { ok: true, service: "race-ws" });
      return;
    }
    if (req.method === "POST" && path === "/typing-feedback") {
      await handleTypingFeedback(req, res);
      return;
    }
    if (req.method === "GET" && path === "/daily-board") {
      await handleDailyGet(req, res);
      return;
    }
    if (req.method === "POST" && path === "/daily-board") {
      await handleDailyPost(req, res);
      return;
    }
    sendJson(req, res, 404, { ok: false });
  } catch (error) {
    console.error(error);
    sendJson(req, res, 500, { message: "Server error" });
  }
}
