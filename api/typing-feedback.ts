import {
  getTypingFeedbackFromSessions,
  type TypingSessionInput,
} from "./_lib/typing-coach";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

type RequestBody = {
  sessions?: TypingSessionInput[];
};

type NodeRequest = {
  method?: string;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<string | Uint8Array>;
};

type NodeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Client-Version",
} as const;

function applyCors(res: NodeResponse): void {
  res.setHeader(
    "Access-Control-Allow-Methods",
    CORS_HEADERS["Access-Control-Allow-Methods"],
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    CORS_HEADERS["Access-Control-Allow-Headers"],
  );
}

function sendJson(res: NodeResponse, status: number, payload: unknown): void {
  applyCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function webJson(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

async function readJsonBody(req: NodeRequest): Promise<unknown> {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }

  if (typeof req[Symbol.asyncIterator] !== "function") {
    return {};
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req as AsyncIterable<string | Uint8Array>) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
    );
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const raw = new TextDecoder().decode(merged);
  if (raw.trim() === "") return {};
  return JSON.parse(raw);
}

async function feedbackFromBody(
  body: RequestBody,
): Promise<{ status: number; payload: unknown }> {
  const sessions = body.sessions;
  if (!Array.isArray(sessions)) {
    return {
      status: 400,
      payload: { message: "sessions array is required", data: null },
    };
  }

  try {
    const feedback = await getTypingFeedbackFromSessions(sessions);
    return {
      status: 200,
      payload: { message: "Typing feedback generated", data: feedback },
    };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to generate typing feedback";
    return { status: 500, payload: { message, data: null } };
  }
}

async function handleNode(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    applyCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed", data: null });
    return;
  }

  let body: RequestBody;
  try {
    body = (await readJsonBody(req)) as RequestBody;
  } catch {
    sendJson(res, 400, { message: "Invalid JSON body", data: null });
    return;
  }

  const result = await feedbackFromBody(body);
  sendJson(res, result.status, result.payload);
}

async function handleWeb(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return webJson(405, { message: "Method not allowed", data: null });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return webJson(400, { message: "Invalid JSON body", data: null });
  }

  const result = await feedbackFromBody(body);
  return webJson(result.status, result.payload);
}

export default async function handler(
  req: NodeRequest | Request,
  res?: NodeResponse,
): Promise<void | Response> {
  if (res !== undefined && typeof res.end === "function") {
    await handleNode(req as NodeRequest, res);
    return;
  }
  return handleWeb(req as Request);
}
