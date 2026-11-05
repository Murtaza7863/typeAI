import { once } from "node:events";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { RaceServerMessage } from "@typeai/schemas/race";
import { afterEach, describe, expect, it } from "vitest";
import { RawData, WebSocket } from "ws";
import "../../src/race/prepare-logs";
import { attachRaceWebSocket } from "../../src/race/ws-server";

function listen(): Promise<{ port: number; close: () => Promise<void> }> {
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

async function partyState(
  messages: RaceServerMessage[],
): Promise<RaceServerMessage> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const found = messages.find((message) => message.type === "partyState");
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for partyState");
}

describe("race invite links", () => {
  const previous = process.env["FRONTEND_URL"];

  afterEach(() => {
    if (previous === undefined) delete process.env["FRONTEND_URL"];
    else process.env["FRONTEND_URL"] = previous;
  });

  it("uses the host site when the origin is allowed", async () => {
    const server = await listen();
    const host = new WebSocket(`ws://127.0.0.1:${server.port}/race-ws`, {
      origin: "https://typeaiapp.vercel.app",
    });
    await once(host, "open");
    const messages = collect(host);
    host.send(
      JSON.stringify({
        type: "createParty",
        displayName: "Host",
        settings: { mode: "words", wordCount: 25, punctuation: false },
      }),
    );
    const created = await partyState(messages);
    if (created.type !== "partyState") throw new Error("missing party");
    expect(created.party.inviteUrl).toMatch(
      /^https:\/\/typeaiapp\.vercel\.app\/race\//,
    );
    host.close();
    await server.close();
  });

  it("falls back when the origin is not the public site", async () => {
    process.env["FRONTEND_URL"] = "https://typeaiapp.vercel.app";
    const server = await listen();
    const host = new WebSocket(`ws://127.0.0.1:${server.port}/race-ws`, {
      origin: "https://evil.example",
    });
    await once(host, "open");
    const messages = collect(host);
    host.send(
      JSON.stringify({
        type: "createParty",
        displayName: "Host",
        settings: { mode: "words", wordCount: 25, punctuation: false },
      }),
    );
    const created = await partyState(messages);
    if (created.type !== "partyState") throw new Error("missing party");
    expect(created.party.inviteUrl).toMatch(
      /^https:\/\/typeaiapp\.vercel\.app\/race\//,
    );
    host.close();
    await server.close();
  });
});
