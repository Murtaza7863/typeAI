import { JSXElement } from "solid-js";

import { AnimatedModal } from "../common/AnimatedModal";
import { Button } from "../common/Button";
import { Fa } from "../common/Fa";

export function SupportModal(): JSXElement {
  const buttonClass =
    "p-4 flex flex-col text-md h-full justify-center items-center";
  const iconScale = 2;

  return (
    <AnimatedModal id="Support" title="Support typeAI" modalClass="max-w-4xl">
      <div>
        Thank you so much for thinking about supporting this project. It would
        not be possible without you and your continued support.{" "}
        <Fa icon="fa-heart" />
      </div>
      <div class="grid grid-cols-1 gap-4 xs:grid-cols-2 md:grid-cols-3">
        <Button
          variant="button"
          href="https://ko-fi.com/typeai"
          fa={{
            icon: "fa-donate",
            fixedWidth: true,
            size: iconScale,
          }}
          text="Donate"
          class={buttonClass}
        />
        <Button
          variant="button"
          href="https://www.patreon.com/typeai"
          fa={{
            variant: "brand",
            icon: "fa-patreon",
            fixedWidth: true,
            size: iconScale,
          }}
          text="Join Patreon"
          class={buttonClass}
        />
        <Button
          variant="button"
          href="https://typeai.store"
          fa={{
            icon: "fa-tshirt",
            fixedWidth: true,
            size: iconScale,
          }}
          text="Buy Merch"
          class={buttonClass}
        />
      </div>
    </AnimatedModal>
  );
}
