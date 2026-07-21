export type EnvConfig = {
  backendUrl: string;
  isDevelopment: boolean;
  liteMode: boolean;
  clientVersion: string;
  recaptchaSiteKey: string;
  quickLoginEmail: string | undefined;
  quickLoginPassword: string | undefined;
  /** Optional Firebase web config from `FIREBASE_CONFIG` env (JSON). */
  firebaseConfig: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    databaseURL?: string;
  } | null;
};

declare module "virtual:env-config" {
  export const envConfig: EnvConfig;
}
