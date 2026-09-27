import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ACCENT_DOT_CLASSES, type AccentColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: AccentColor | null;
  onChange: (color: AccentColor | null) => void;
}

/** Every accent color, in display order. */
const COLORS: readonly AccentColor[] = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "blue",
  "violet",
  "pink",
];

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const { t } = useTranslation();

  /** A pastille toggles: pressing the selected one clears the color. */
  const select = (color: AccentColor | null) => (event: MouseEvent<HTMLButtonElement>) => {
    // A button inside a Radix menu steals focus; keep the menu open.
    event.preventDefault();
    onChange(value === color ? null : color);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={value === null}
        aria-label={t("colors.none")}
        onClick={select(null)}
        className={cn(
          "flex size-6 items-center justify-center rounded-full border border-border transition-colors",
          value === null ? "border-primary bg-muted" : "hover:bg-muted/60",
        )}
      >
        {value === null && <span className="size-2 rounded-full bg-primary-foreground" />}
      </button>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-pressed={value === color}
          aria-label={t(`colors.${color}`)}
          onClick={select(color)}
          className={cn(
            "size-6 rounded-full transition-transform",
            ACCENT_DOT_CLASSES[color],
            value === color && "ring-2 ring-ring ring-offset-2 ring-offset-background",
            "hover:scale-110",
          )}
        />
      ))}
    </div>
  );
}
