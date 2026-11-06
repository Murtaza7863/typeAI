import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  handlePublicHttp,
  resetPublicHttpForTests,
  setRedisForTests,
  setTypingCoachForTests,
} from "../../src/race/public-http";

type Command = (string | number)[];

function listen(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handlePublicHttp(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function memoryRedis(): (command: Command) => Promise<unknown> {
  const scores = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();
  return async (command) => {
    const op = String(command[0]);
    const key = String(command[1]);
    if (op === "ZSCORE") {
      return scores.get(key)?.get(String(command[2])) ?? null;
    }
    if (op === "ZADD") {
      const board = scores.get(key) ?? new Map<string, number>();
      const greaterOnly = command[2] === "GT";
      const score = Number(greaterOnly ? command[3] : command[2]);
      const member = String(command[greaterOnly ? 4 : 3]);
      const current = board.get(member);
      if (greaterOnly && current !== undefined && current >= score) {
        return 0;
      }
      board.set(member, score);
      scores.set(key, board);
      return 1;
    }
    if (op === "HSET") {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(String(command[2]), String(command[3]));
      hashes.set(key, hash);
      return 1;
    }
    if (op === "HSETNX") {
      const hash = hashes.get(key) ?? new Map<string, string>();
      const field = String(command[2]);
      if (hash.has(field)) return 0;
      hash.set(field, String(command[3]));
      hashes.set(key, hash);
      return 1;
    }
    if (op === "HGET") {
      return hashes.get(key)?.get(String(command[2])) ?? null;
    }
    if (op === "INCR") {
      const counts = hashes.get("__counts") ?? new Map<string, string>();
      const next = Number(counts.get(key) ?? "0") + 1;
      counts.set(key, String(next));
      hashes.set("__counts", counts);
      return next;
    }
    if (op === "EXPIRE" || op === "EXPIREAT") return 1;
    if (op === "ZRANGE") {
      const board = [...(scores.get(key)?.entries() ?? [])];
      board.sort((left, right) => right[1] - left[1]);
      return board.flatMap(([member, score]) => [member, score]);
    }
    if (op === "HGETALL") {
      return Object.fromEntries(hashes.get(key)?.entries() ?? []);
    }
    throw new Error(op);
  };
}

describe("race public http", () => {
  afterEach(() => {
    resetPublicHttpForTests();
  });

  it("returns AI feedback for an allowed site", async () => {
    setTypingCoachForTests(async (sessions) => ({
      ready: true,
      testsAnalyzed: sessions.length,
      minTestsRequired: 3,
      summary: "Keep the wrists loose.",
      poweredByAi: true,
      source: "local",
    }));
    const server = await listen();
    const response = await fetch(`${server.url}/typing-feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://typeaiapp.vercel.app",
      },
      body: JSON.stringify({
        sessions: [{ wpm: 80 }, { wpm: 90 }, { wpm: 100 }],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://typeaiapp.vercel.app",
    );
    const body = (await response.json()) as { data: { summary: string } };
    expect(body.data.summary).toBe("Keep the wrists loose.");
    await server.close();
  });

  it("keeps the best daily score for a nickname", async () => {
    setRedisForTests(memoryRedis());
    const server = await listen();
    const headers = {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    };
    const first = await fetch(`${server.url}/daily-board`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        nickname: "Ada",
        wpm: 120,
        acc: 98,
        mode: "time",
        mode2: "60",
      }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { token?: string };
    const second = await fetch(`${server.url}/daily-board`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        nickname: "Ada",
        wpm: 40,
        acc: 90,
        mode: "time",
        mode2: "15",
        token: firstBody.token,
      }),
    });
    const body = (await second.json()) as {
      entries: { nickname: string; wpm: number; acc: number }[];
    };
    expect(body.entries[0]).toMatchObject({
      nickname: "Ada",
      wpm: 120,
      acc: 98,
    });
    const impostor = await fetch(`${server.url}/daily-board`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        nickname: "Ada",
        wpm: 200,
        acc: 99,
        mode: "time",
        mode2: "60",
      }),
    });
    expect(impostor.status).toBe(403);
    await server.close();
  });

  it("rejects a nickname that is not letters or numbers", async () => {
    setRedisForTests(memoryRedis());
    const server = await listen();
    const response = await fetch(`${server.url}/daily-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "no spaces",
        wpm: 80,
        acc: 95,
        mode: "words",
        mode2: "25",
      }),
    });
    expect(response.status).toBe(400);
    await server.close();
  });

  it("stops a network after 10 scores in an hour", async () => {
    setRedisForTests(memoryRedis());
    const server = await listen();
    const headers = { "Content-Type": "application/json" };
    for (let count = 0; count < 10; count++) {
      const response = await fetch(`${server.url}/daily-board`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          nickname: `Racer${count}`,
          wpm: 80,
          acc: 95,
          mode: "words",
          mode2: "10",
        }),
      });
      expect(response.status).toBe(200);
    }
    const blocked = await fetch(`${server.url}/daily-board`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        nickname: "RacerX",
        wpm: 80,
        acc: 95,
        mode: "words",
        mode2: "10",
      }),
    });
    expect(blocked.status).toBe(429);
    await server.close();
  });

  it("says the board is off when redis is not configured", async () => {
    const previousUrl = process.env["UPSTASH_REDIS_REST_URL"];
    const previousToken = process.env["UPSTASH_REDIS_REST_TOKEN"];
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["UPSTASH_REDIS_REST_TOKEN"];
    const server = await listen();
    const response = await fetch(`${server.url}/daily-board`);
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
    await server.close();
    if (previousUrl === undefined) delete process.env["UPSTASH_REDIS_REST_URL"];
    else process.env["UPSTASH_REDIS_REST_URL"] = previousUrl;
    if (previousToken === undefined) {
      delete process.env["UPSTASH_REDIS_REST_TOKEN"];
    } else {
      process.env["UPSTASH_REDIS_REST_TOKEN"] = previousToken;
    }
  });
});
