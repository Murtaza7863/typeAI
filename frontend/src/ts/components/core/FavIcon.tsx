import { Link } from "@solidjs/meta";
import { createMemo, JSXElement } from "solid-js";

import { Theme } from "../../constants/themes";
import { isDevEnvironment } from "../../utils/env";

export function FavIcon(props: { theme: Theme }): JSXElement {
  const icon = createMemo<string>(() => {
    let { main, bg } = props.theme;
    if (isDevEnvironment()) {
      [main, bg] = [bg, main];
    }
    if (bg === main) {
      bg = "#111";
      main = "#eee";
    }

    const svgPre = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <style>
        #bg{fill:${bg};}
        #mark{fill:${main};font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;}
      </style>
      <rect id="bg" width="64" height="64" rx="14"/>
      <text id="mark" x="32" y="41" text-anchor="middle">tAI</text>
    </svg>
    `;
    return `data:image/svg+xml;base64,${btoa(svgPre)}`;
  });

  return (
    <Link id="favicon" rel="shortcut icon" type="image/svg+xml" href={icon()} />
  );
}
