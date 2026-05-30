import { JSXElement } from "solid-js";

import { restartTestEvent } from "../../../events/test";
import { getActivePage } from "../../../states/core";
import { getFocus } from "../../../states/test";
import { cn } from "../../../utils/cn";
import { isDevEnvironment } from "../../../utils/env";

export function Logo(): JSXElement {
  return (
    <a
      href={`${location.origin}/`}
      class="-m-2 flex h-6 w-max rounded-[0.8rem] p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-main"
      aria-label="typeAI home"
      router-link
      style={{
        "box-sizing": "content-box",
        "font-family": "Lexend Deca ,sans-serif",
      }}
      data-ui-element="logo"
      onClick={() => {
        if (getActivePage() === "test") restartTestEvent.dispatch();
      }}
    >
      <div class="grid h-6 place-content-center text-[1.5rem] leading-none font-semibold sm:text-[2rem]">
        <span
          class={cn(
            "hidden text-[0.315em] leading-none text-sub transition-colors duration-125 lg:block",
            {
              "text-transparent": getFocus(),
            },
          )}
          data-ui-element="logoSubtext"
        >
          {isDevEnvironment() ? "localhost" : "type smart"}
        </span>
        <span
          class={cn("text-text transition-colors duration-250", {
            "text-sub": getFocus(),
          })}
          data-ui-element="logoText"
        >
          typeAI
        </span>
      </div>
    </a>
  );
}
