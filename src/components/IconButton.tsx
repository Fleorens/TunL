import type { ComponentProps, JSX } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "size"> & {
  /** Traduit : le nom accessible ET l'infobulle. */
  label: string;
  /** `xs` → `icon-xs` (24 px), `sm` → `icon-sm` (32 px, défaut), `md` → `icon` (36 px). */
  size?: "xs" | "sm" | "md";
};

const SIZE: Record<NonNullable<IconButtonProps["size"]>, ComponentProps<typeof Button>["size"]> = {
  xs: "icon-xs",
  sm: "icon-sm",
  md: "icon",
};

export function IconButton(props: IconButtonProps): JSX.Element {
  const { label, size = "sm", ...rest } = props;
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size={SIZE[size]} aria-label={label} {...rest} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
