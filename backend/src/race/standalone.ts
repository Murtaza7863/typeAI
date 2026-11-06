import "./prepare-logs.js";
import { createServer } from "node:http";
import { handlePublicHttp } from "./public-http.js";
import {
  attachRaceWebSocket,
  restoreParties,
  resumeRestoredParties,
} from "./ws-server.js";

const port = Number.parseInt(process.env["PORT"] ?? "5005", 10);
const server = createServer((req, res) => {
  void handlePublicHttp(req, res);
});
attachRaceWebSocket(server);
void restoreParties().finally(() => {
  server.listen(port, () => {
    resumeRestoredParties();
    console.log(`Race server listening on ${port}`);
  });
});
