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
      class="-m-2 flex h-6 w-max items-center gap-2 rounded-[0.8rem] p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-main"
      aria-label="typeAI home"
      router-link
      style={{
        "box-sizing": "content-box",
        "font-family": "Lexend Deca, sans-serif",
        "letter-spacing": "-0.03em",
      }}
      data-ui-element="logo"
      onClick={() => {
        if (getActivePage() === "test") restartTestEvent.dispatch();
      }}
    >
      <span
        class={cn("hidden h-5 w-1.5 shrink-0 rounded-full bg-main sm:block", {
          "bg-sub": getFocus(),
        })}
        aria-hidden="true"
      ></span>
      <div class="grid h-6 place-content-center text-[1.5rem] leading-none font-semibold sm:text-[2rem]">
        <span
          class={cn(
            "hidden text-[0.315em] leading-none tracking-[0.18em] text-sub uppercase transition-colors duration-125 lg:block",
            {
              "text-transparent": getFocus(),
            },
          )}
          data-ui-element="logoSubtext"
        >
          {isDevEnvironment() ? "localhost" : "type smart"}
        </span>
        <span
          class={cn("transition-colors duration-250", {
            "text-sub": getFocus(),
          })}
          data-ui-element="logoText"
        >
          <span classList={{ "text-text": !getFocus() }}>type</span>
          <span classList={{ "text-main": !getFocus() }}>AI</span>
        </span>
      </div>
    </a>
  );
}
