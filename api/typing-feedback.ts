import {
  getTypingFeedbackFromSessions,
  type TypingSessionInput,
} from "./_lib/typing-coach";

export const config = {
  maxDuration: 60,
};

type RequestBody = {
  sessions?: TypingSessionInput[];
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, X-Client-Version",
      },
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      { message: "Method not allowed", data: null },
      { status: 405 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json(
      { message: "Invalid JSON body", data: null },
      { status: 400 },
    );
  }

  const sessions = body.sessions;
  if (!Array.isArray(sessions)) {
    return Response.json(
      { message: "sessions array is required", data: null },
      { status: 400 },
    );
  }

  try {
    const feedback = await getTypingFeedbackFromSessions(sessions);
    return Response.json({
      message: "Typing feedback generated",
      data: feedback,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to generate typing feedback";
    return Response.json({ message, data: null }, { status: 500 });
  }
}
