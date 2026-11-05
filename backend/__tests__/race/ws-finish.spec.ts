import { once } from "node:events";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { RaceServerMessage } from "@typeai/schemas/race";
import { describe, expect, it } from "vitest";
import { RawData, WebSocket } from "ws";
import "../../src/race/prepare-logs";
import { attachRaceWebSocket } from "../../src/race/ws-server";

function listen(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  attachRaceWebSocket(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function messageText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function collect(ws: WebSocket): RaceServerMessage[] {
  const messages: RaceServerMessage[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(messageText(data)) as RaceServerMessage);
  });
  return messages;
}

async function waitFor(
  messages: RaceServerMessage[],
  type: RaceServerMessage["type"],
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (messages.some((message) => message.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${type}`);
}

describe("race websocket", () => {
  it("completes when both players finish", async () => {
    const server = await listen();
    const host = new WebSocket(`ws://127.0.0.1:${server.port}/race-ws`);
    const guest = new WebSocket(`ws://127.0.0.1:${server.port}/race-ws`);
    await Promise.all([once(host, "open"), once(guest, "open")]);
    const hostMessages = collect(host);
    const guestMessages = collect(guest);

    host.send(
      JSON.stringify({
        type: "createParty",
        displayName: "Host",
        settings: { mode: "words", wordCount: 25, punctuation: false },
      }),
    );
    await waitFor(hostMessages, "partyState");
    const created = hostMessages.find(
      (message) => message.type === "partyState",
    );
    if (created === undefined || created.type !== "partyState") {
      throw new Error("missing party");
    }

    guest.send(
      JSON.stringify({
        type: "joinParty",
        code: created.party.code,
        displayName: "Guest",
      }),
    );
    await waitFor(guestMessages, "partyState");

    host.send(JSON.stringify({ type: "startRace" }));
    await waitFor(hostMessages, "raceStart");
    await waitFor(guestMessages, "raceStart");

    host.send(JSON.stringify({ type: "finished", timeMs: 4000 }));
    guest.send(JSON.stringify({ type: "finished", timeMs: 6200 }));
    await waitFor(hostMessages, "raceComplete");
    await waitFor(guestMessages, "raceComplete");

    const complete = hostMessages.find(
      (message) => message.type === "raceComplete",
    );
    if (complete === undefined || complete.type !== "raceComplete") {
      throw new Error("missing raceComplete");
    }
    expect(complete.winnerId).toBe(created.you.id);
    expect(complete.standings).toHaveLength(2);
    expect(complete.standings[0]?.timeMs).toBe(4000);

    host.close();
    guest.close();
    await Promise.all([once(host, "close"), once(guest, "close")]);
    await server.close();
  });
});
