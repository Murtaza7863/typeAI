import { createEvent } from "../hooks/createEvent";

export const restartTestEvent = createEvent<
  { isQuickRestart?: boolean; noAnim?: boolean } | undefined
>();
