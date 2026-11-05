import { envConfig } from "virtual:env-config";

export function raceHttpOrigin(): string | null {
  const raw = envConfig.raceWsUrl;
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol === "ws:") url.protocol = "http:";
    else return null;
    return url.origin;
  } catch {
    return null;
  }
}
