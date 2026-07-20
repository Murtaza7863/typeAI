import { RacePartyState, RacePlayer } from "@typeai/schemas/race";
import { createSignal } from "solid-js";

export type RaceSession = {
  code: string;
  playerId: string;
  displayName: string;
};

const SESSION_KEY = "typeai-race-session";

export const [getRaceParty, setRaceParty] = createSignal<RacePartyState | null>(
  null,
);

export const [getRaceYou, setRaceYou] = createSignal<RacePlayer | null>(null);
export const [getRaceError, setRaceError] = createSignal<string | null>(null);
export const [getRaceWsConnected, setRaceWsConnected] = createSignal(false);
export const [getCountdownSeconds, setCountdownSeconds] = createSignal<
  number | null
>(null);
export const [getLocalFinished, setLocalFinished] = createSignal(false);
export const [getStandings, setStandings] = createSignal<RacePlayer[]>([]);
export const [isRaceActive, setIsRaceActive] = createSignal(false);
export const [getRaceStartedAt, setRaceStartedAt] = createSignal<number | null>(
  null,
);

export function getRaceSession(): RaceSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as RaceSession;
  } catch {
    return null;
  }
}

export function setRaceSession(session: RaceSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearRaceSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function isInRaceLobby(): boolean {
  const party = getRaceParty();
  return party !== null && party.status === "lobby";
}

export function isRacing(): boolean {
  const party = getRaceParty();
  return (
    isRaceActive() ||
    party?.status === "racing" ||
    party?.status === "countdown"
  );
}
