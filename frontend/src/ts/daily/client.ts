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
};

const NICKNAME_KEY = "typeai-daily-nickname";
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
  };
}

export async function fetchDailyBoard(): Promise<DailyBoardResponse> {
  return boardRequest("/daily-board");
}

export async function postDailyScore(
  entry: DailyEntry,
): Promise<DailyBoardResponse> {
  saveDailyNickname(entry.nickname);
  return boardRequest("/daily-board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}
