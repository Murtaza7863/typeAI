import { envConfig } from "virtual:env-config";
import { buildClient } from "./adapters/ts-rest-adapter";
import { contract } from "@monkeytype/contracts";

const BASE_URL = envConfig.backendUrl;

// API Endpoints
const Ape = buildClient(contract, BASE_URL, 10_000);

export default Ape;
