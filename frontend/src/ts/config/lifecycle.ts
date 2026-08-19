import * as ConfigSchemas from "@typeai/schemas/configs";
import { parseWithSchema as parseJsonWithSchema } from "@typeai/util/json";
import {
  showSuccessNotification,
  showErrorNotification,
} from "../states/notifications";
import {
  configLS,
  saveToLocalStorage,
  saveFullConfigToLocalStorage,
} from "./persistence";
import { Config, setConfigStore } from "./store";
import { getDefaultConfig } from "../constants/default-config";
import { configEvent } from "../events/config";
import { migrateConfig } from "./utils";
import { promiseWithResolvers, typedKeys } from "../utils/misc";
import { setConfig } from "./setters";
import { deleteConfig } from "../ape/config";
import { reconcile } from "solid-js/store";

export async function applyConfigFromJson(json: string): Promise<void> {
  try {
    const parsedConfig = parseJsonWithSchema(
      json,
      ConfigSchemas.PartialConfigSchema.strip(),
      {
        migrate: (value) => {
          if (Array.isArray(value)) {
            throw new Error("Invalid config");
          }
          return migrateConfig(value);
        },
      },
    );
    await applyConfig(parsedConfig);
    saveFullConfigToLocalStorage();
    showSuccessNotification("Done");
  } catch (e) {
    console.error(e);
    showErrorNotification("Failed to import settings", { error: e });
  }
}

export async function loadFromLocalStorage(): Promise<void> {
  console.log("loading localStorage config");
  const newConfig = configLS.get();
  if (newConfig === undefined) {
    await resetConfig();
  } else {
    await applyConfig(newConfig);
    migrateBrandLookOnce();
    saveFullConfigToLocalStorage(true);
  }
  loadDone();
}

const BRAND_VERSION_KEY = "typeaiBrandV";
const BRAND_VERSION = "4";

/** Move users still on Monkeytype/default teal themes onto the typeAI look. */
function migrateBrandLookOnce(): void {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(BRAND_VERSION_KEY) === BRAND_VERSION) {
    return;
  }

  const theme = Config.theme;
  if (theme === "serika_dark" || theme === "serika" || theme === "dark") {
    setConfig("theme", "typeai", { nosave: true });
    setConfig("themeDark", "typeai", { nosave: true });
  }

  window.localStorage.setItem(BRAND_VERSION_KEY, BRAND_VERSION);
}

const lastConfigsToApply: Set<keyof ConfigSchemas.Config> = new Set([
  "keymapMode",
  "minWpm",
  "minAcc",
  "minBurst",
  "paceCaret",
  "quoteLength", //quote length sets mode,
  "words",
  "time",
  "mode", // mode sets punctuation and numbers
  "numbers",
  "punctuation",
  "funbox",
]);

export async function applyConfig(
  partialConfig: Partial<ConfigSchemas.Config>,
): Promise<void> {
  if (partialConfig === undefined || partialConfig === null) return;

  //migrate old values if needed, remove additional keys and merge with default config
  const fullConfig: ConfigSchemas.Config = migrateConfig(partialConfig);

  configEvent.dispatch({ key: "fullConfigChange" });

  const defaultConfig = getDefaultConfig();
  for (const key of typedKeys(fullConfig)) {
    //@ts-expect-error this is fine, both are of type config
    Config[key] = defaultConfig[key];
  }

  const configKeysToReset: (keyof ConfigSchemas.Config)[] = [];

  const firstKeys = typedKeys(fullConfig).filter(
    (key) => !lastConfigsToApply.has(key),
  );

  for (const configKey of [...firstKeys, ...lastConfigsToApply]) {
    const configValue = fullConfig[configKey];

    const set = setConfig(configKey, configValue, {
      nosave: true,
      partOfFullConfigChange: true,
    });

    if (!set) {
      configKeysToReset.push(configKey);
    }
  }

  for (const key of configKeysToReset) {
    saveToLocalStorage(key);
  }

  configEvent.dispatch({ key: "fullConfigChangeFinished" });
  setConfigStore(reconcile(Config));
}

export async function resetConfig(): Promise<void> {
  await applyConfig(getDefaultConfig());
  await deleteConfig();
  saveFullConfigToLocalStorage(true);
}

const { promise: configLoadPromise, resolve: loadDone } =
  promiseWithResolvers();

export { configLoadPromise };
