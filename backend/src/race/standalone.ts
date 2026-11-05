import "./prepare-logs.js";
import { createServer } from "node:http";
import { handlePublicHttp } from "./public-http.js";
import { attachRaceWebSocket } from "./ws-server.js";

const port = Number.parseInt(process.env["PORT"] ?? "5005", 10);
const server = createServer((req, res) => {
  void handlePublicHttp(req, res);
});
attachRaceWebSocket(server);
server.listen(port, () => {
  console.log(`Race server listening on ${port}`);
});
