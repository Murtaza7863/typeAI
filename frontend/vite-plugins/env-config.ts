import { Plugin } from "vite";
import { EnvConfig } from "virtual:env-config";

const virtualModuleId = "virtual:env-config";
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

function fallback(value: string | undefined | null, fallback: string): string {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function parseFirebaseConfig(
  raw: string | undefined,
): EnvConfig["firebaseConfig"] {
  if (raw === undefined || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const apiKey = typeof parsed["apiKey"] === "string" ? parsed["apiKey"] : "";
    const authDomain =
      typeof parsed["authDomain"] === "string" ? parsed["authDomain"] : "";
    const projectId =
      typeof parsed["projectId"] === "string" ? parsed["projectId"] : "";
    const appId = typeof parsed["appId"] === "string" ? parsed["appId"] : "";
    if (
      apiKey.trim() === "" ||
      authDomain.trim() === "" ||
      projectId.trim() === "" ||
      appId.trim() === ""
    ) {
      console.warn(
        "FIREBASE_CONFIG is set but missing apiKey/authDomain/projectId/appId",
      );
      return null;
    }
    return {
      apiKey,
      authDomain,
      projectId,
      appId,
      storageBucket:
        typeof parsed["storageBucket"] === "string"
          ? parsed["storageBucket"]
          : undefined,
      messagingSenderId:
        typeof parsed["messagingSenderId"] === "string"
          ? parsed["messagingSenderId"]
          : undefined,
      databaseURL:
        typeof parsed["databaseURL"] === "string"
          ? parsed["databaseURL"]
          : undefined,
    };
  } catch (error) {
    console.warn("Failed to parse FIREBASE_CONFIG JSON", error);
    return null;
  }
}

export function envConfig(options: {
  isDevelopment: boolean;
  clientVersion: string;
  env: Record<string, string>;
}): Plugin {
  return {
    name: "virtual-env-config",
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      return;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        const liteMode = options.env["LITE_MODE"] === "true";
        const firebaseConfig = parseFirebaseConfig(
          options.env["FIREBASE_CONFIG"],
        );
        const devConfig: EnvConfig = {
          isDevelopment: true,
          backendUrl: fallback(
            options.env["BACKEND_URL"],
            "http://localhost:5005",
          ),
          liteMode,
          clientVersion: options.clientVersion,
          recaptchaSiteKey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
          quickLoginEmail: options.env["QUICK_LOGIN_EMAIL"],
          quickLoginPassword: options.env["QUICK_LOGIN_PASSWORD"],
          firebaseConfig,
        };

        const prodConfig: EnvConfig = {
          isDevelopment: false,
          backendUrl: fallback(
            options.env["BACKEND_URL"],
            "https://api.typeai.com",
          ),
          liteMode,
          recaptchaSiteKey: options.env["RECAPTCHA_SITE_KEY"] ?? "",
          quickLoginEmail: undefined,
          quickLoginPassword: undefined,
          clientVersion: options.clientVersion,
          firebaseConfig,
        };

        const envConfig = options.isDevelopment ? devConfig : prodConfig;
        return `
          export const envConfig = ${JSON.stringify(envConfig)};
        `;
      }
      return;
    },
  };
}
