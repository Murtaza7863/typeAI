import { Language } from "@typeai/schemas/languages";

declare module "virtual:language-hashes" {
  export const languageHashes: Record<Language, string>;
}
