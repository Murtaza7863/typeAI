import {
  getTypingFeedbackFromSessions,
  type TypingSessionInput,
} from "./typing-coach.js";

type RequestBody = {
  sessions?: TypingSessionInput[];
};

type NodeRequest = {
  method?: string;
  body?: unknown;
};

type NodeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
};

function sendJson(res: NodeResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Client-Version",
  );
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export default async function handler(
  req: NodeRequest,
  res: NodeResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Client-Version",
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed", data: null });
    return;
  }

  let body: RequestBody = {};
  try {
    if (typeof req.body === "string") {
      body = JSON.parse(req.body) as RequestBody;
    } else if (req.body !== undefined && req.body !== null) {
      body = req.body as RequestBody;
    }
  } catch {
    sendJson(res, 400, { message: "Invalid JSON body", data: null });
    return;
  }

  if (!Array.isArray(body.sessions)) {
    sendJson(res, 400, { message: "sessions array is required", data: null });
    return;
  }

  try {
    const feedback = await getTypingFeedbackFromSessions(body.sessions);
    sendJson(res, 200, {
      message: "Typing feedback generated",
      data: feedback,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to generate typing feedback";
    sendJson(res, 500, { message, data: null });
  }
}
