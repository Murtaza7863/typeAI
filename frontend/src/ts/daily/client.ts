import { raceHttpOrigin } from "../race/http-origin";

export type DailyEntry = {
  nickname: string;
  wpm: number;
  acc: number;
  mode: string;
  mode2: string;
};

export type DailyBoardResponse = {
  configured: boolean;
  entries: DailyEntry[];
  token?: string;
};

const NICKNAME_KEY = "typeai-daily-nickname";

function tokenKey(nickname: string): string {
  return `typeai-daily-token:${nickname}`;
}

function readDailyToken(nickname: string): string | undefined {
  try {
    const token = localStorage.getItem(tokenKey(nickname));
    return token !== null && token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

function saveDailyToken(nickname: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(nickname), token);
  } catch {
    return;
  }
}
const NICKNAME = /^[A-Za-z0-9]{2,16}$/;

export function readDailyNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDailyNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    return;
  }
}

export function dailyNicknameValid(nickname: string): boolean {
  return NICKNAME.test(nickname);
}

async function boardRequest(
  path: string,
  init?: RequestInit,
): Promise<DailyBoardResponse> {
  const origin = raceHttpOrigin();
  if (origin === null) return { configured: false, entries: [] };
  const response = await fetch(`${origin}${path}`, init);
  const body = (await response.json()) as DailyBoardResponse & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message ?? "Could not reach today's board");
  }
  return {
    configured: body.configured,
    entries: Array.isArray(body.entries) ? body.entries : [],
    token: typeof body.token === "string" ? body.token : undefined,
  };
}

export async function fetchDailyBoard(): Promise<DailyBoardResponse> {
  return boardRequest("/daily-board");
}

export async function postDailyScore(
  entry: DailyEntry,
): Promise<DailyBoardResponse> {
  saveDailyNickname(entry.nickname);
  const token = readDailyToken(entry.nickname);
  const saved = await boardRequest("/daily-board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(token === undefined ? entry : { ...entry, token }),
  });
  if (saved.token !== undefined) saveDailyToken(entry.nickname, saved.token);
  return saved;
}
