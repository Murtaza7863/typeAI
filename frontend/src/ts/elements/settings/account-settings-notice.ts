import { z } from "zod";
import { LocalStorageWithSchema } from "../../utils/local-storage-with-schema";
import { navigate } from "../../controllers/route-controller";
import { ACCOUNTS_ENABLED } from "../../constants/features";
import { qsa } from "../../utils/dom";

if (!ACCOUNTS_ENABLED) {
  qsa(".pageSettings .accountSettingsNotice")?.remove();
}

const ls = new LocalStorageWithSchema({
  key: "accountSettingsMessageDismissed",
  schema: z.boolean(),
  fallback: false,
});

if (ls.get()) {
  qsa(".pageSettings .accountSettingsNotice")?.remove();
}

qsa(".pageSettings .accountSettingsNotice .dismissAndGo").on("click", () => {
  ls.set(true);
  void navigate("/account-settings");
  qsa(".pageSettings .accountSettingsNotice")?.remove();
});
