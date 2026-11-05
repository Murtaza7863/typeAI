import "./prepare-logs.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { attachRaceWebSocket } from "./ws-server.js";

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "race-ws" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false }));
}

const port = Number.parseInt(process.env["PORT"] ?? "5005", 10);
const server = createServer(handleRequest);
attachRaceWebSocket(server);
server.listen(port, () => {
  console.log(`Race server listening on ${port}`);
});
