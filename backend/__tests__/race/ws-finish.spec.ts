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

  it("shows the first finish to the other racer before the race ends", async () => {
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
    const joined = guestMessages.find(
      (message) => message.type === "partyState",
    );
    if (joined === undefined || joined.type !== "partyState") {
      throw new Error("missing guest");
    }

    host.send(JSON.stringify({ type: "startRace" }));
    await waitFor(hostMessages, "raceStart");
    await waitFor(guestMessages, "raceStart");

    host.send(JSON.stringify({ type: "finished", timeMs: 4000 }));
    await waitFor(guestMessages, "playerFinished");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      guestMessages.some((message) => message.type === "raceComplete"),
    ).toBe(false);
    const seen = guestMessages.find(
      (message) => message.type === "playerFinished",
    );
    if (seen === undefined || seen.type !== "playerFinished") {
      throw new Error("missing playerFinished");
    }
    expect(seen.playerId).toBe(created.you.id);
    expect(
      seen.standings.find((player) => player.id === created.you.id)?.timeMs,
    ).toBe(4000);

    guest.send(JSON.stringify({ type: "finished", timeMs: 6200 }));
    await waitFor(hostMessages, "raceComplete");
    const complete = [...hostMessages]
      .reverse()
      .find((message) => message.type === "raceComplete");
    if (complete === undefined || complete.type !== "raceComplete") {
      throw new Error("missing raceComplete");
    }
    expect(complete.standings.map((player) => player.timeMs)).toEqual([
      4000, 6200,
    ]);

    host.close();
    guest.close();
    await Promise.all([once(host, "close"), once(guest, "close")]);
    await server.close();
  });

  it("records a finish that arrives after the race already closed", async () => {
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
    const joined = [...guestMessages]
      .reverse()
      .find((message) => message.type === "partyState");
    if (joined === undefined || joined.type !== "partyState") {
      throw new Error("missing guest");
    }

    host.send(JSON.stringify({ type: "startRace" }));
    await waitFor(guestMessages, "raceStart");
    guest.close();
    await once(guest, "close");
    host.send(JSON.stringify({ type: "finished", timeMs: 4000 }));
    await waitFor(hostMessages, "raceComplete");

    const returned = new WebSocket(`ws://127.0.0.1:${server.port}/race-ws`);
    await once(returned, "open");
    const returnedMessages = collect(returned);
    returned.send(
      JSON.stringify({
        type: "reconnect",
        code: created.party.code,
        playerId: joined.you.id,
      }),
    );
    await waitFor(returnedMessages, "partyState");
    returned.send(JSON.stringify({ type: "finished", timeMs: 6200 }));
    const started = Date.now();
    let lateTime: number | null | undefined;
    while (Date.now() - started < 8000) {
      const late = [...hostMessages]
        .reverse()
        .find((message) => message.type === "raceComplete");
      lateTime =
        late?.type === "raceComplete"
          ? late.standings.find((player) => player.id === joined.you.id)?.timeMs
          : undefined;
      if (lateTime === 6200) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(lateTime).toBe(6200);

    host.close();
    returned.close();
    await Promise.all([once(host, "close"), once(returned, "close")]);
    await server.close();
  }, 15_000);
});
