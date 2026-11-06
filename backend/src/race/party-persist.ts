import { PartySnapshot, exportParty, RaceParty } from "./party-store";

const INDEX_KEY = "typeai:parties";
const PARTY_TTL_SECONDS = 2 * 60 * 60;

function configured(): boolean {
  const url = process.env["UPSTASH_REDIS_REST_URL"] ?? "";
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"] ?? "";
  return url !== "" && token !== "";
}

async function redis(command: (string | number)[]): Promise<unknown> {
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

function partyKey(code: string): string {
  return `typeai:party:${code}`;
}

function isSnapshot(value: unknown): value is PartySnapshot {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<PartySnapshot>;
  return (
    typeof record.code === "string" &&
    typeof record.hostId === "string" &&
    typeof record.status === "string" &&
    Array.isArray(record.words) &&
    Array.isArray(record.players) &&
    typeof record.createdAt === "number" &&
    record.settings !== null &&
    typeof record.settings === "object"
  );
}

export async function rememberParty(party: RaceParty): Promise<void> {
  if (!configured()) return;
  const snapshot = exportParty(party);
  await redis([
    "SET",
    partyKey(party.code),
    JSON.stringify(snapshot),
    "EX",
    PARTY_TTL_SECONDS,
  ]);
  await redis(["SADD", INDEX_KEY, party.code]);
  await redis(["EXPIRE", INDEX_KEY, PARTY_TTL_SECONDS]);
}

export async function forgetParty(code: string): Promise<void> {
  if (!configured()) return;
  await redis(["DEL", partyKey(code)]);
  await redis(["SREM", INDEX_KEY, code]);
}

export async function loadRememberedParties(): Promise<PartySnapshot[]> {
  if (!configured()) return [];
  const codes = await redis(["SMEMBERS", INDEX_KEY]);
  if (!Array.isArray(codes)) return [];
  const snapshots: PartySnapshot[] = [];
  for (const code of codes) {
    if (typeof code !== "string" || code.length === 0) continue;
    const raw = await redis(["GET", partyKey(code)]);
    if (typeof raw !== "string" || raw.length === 0) {
      await redis(["SREM", INDEX_KEY, code]);
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isSnapshot(parsed)) snapshots.push(parsed);
    } catch {
      await redis(["SREM", INDEX_KEY, code]);
    }
  }
  return snapshots;
}
