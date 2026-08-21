import * as TestStats from "../test/test-stats";
import * as TestLogic from "../test/test-logic";
import * as Funbox from "../test/funbox/funbox";
import Page from "./page";
import * as ModesNotice from "../elements/modes-notice";
import * as Keymap from "../elements/keymap";
import { blurInputElement } from "../input/input-element";
import { restoreAfterRace } from "../race/controller";
import { getRaceParty } from "../states/race";
import { qsr } from "../utils/dom";

export const page = new Page({
  id: "test",
  element: qsr(".page.pageTest"),
  path: "/",
  beforeHide: async (): Promise<void> => {
    blurInputElement();
  },
  afterHide: async (): Promise<void> => {
    if (getRaceParty()?.status === "finished") {
      restoreAfterRace();
    }
    TestLogic.restart({
      noAnim: true,
    });
    void Funbox.clear();
    void ModesNotice.update();
  },
  beforeShow: async (): Promise<void> => {
    TestStats.resetIncomplete();
    TestLogic.restart({
      noAnim: true,
    });
    void Keymap.refresh();
  },
});
