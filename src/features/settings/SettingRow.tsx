// The rows, selects, switches and card of the Settings tab. A row puts the label (associated to the
// control by `id`) and its help on the left, the control on the right.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * The label and its help on the left, the control on the right. Without a control, the label is a `<p>` (there is
 * nothing to associate it to) and the right column is not rendered.
 */
function SettingRow({
  id,
  label,
  description,
  children,
}: {
  id?: string;
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="grid min-w-0 gap-1">
        {id && children ? (
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
        ) : id ? (
          <p id={id} className="text-sm font-medium">
            {label}
          </p>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {description && (
          <span className="text-xs wrap-anywhere text-muted-foreground">{description}</span>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

/**
 * A select whose options carry their own label. Radix gives a string; the chosen option is found back in
 * the list and returned typed, so the caller never casts.
 */
function SettingSelect<T extends string>({
  id,
  label,
  description,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  description?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <SettingRow id={id} label={label} description={description}>
      <Select
        value={value}
        onValueChange={(next) => {
          const chosen = options.find((option) => option.value === next);
          if (chosen) onChange(chosen.value);
        }}
      >
        <SelectTrigger id={id} aria-label={label} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** A toggle, whose accessible name is its label (a `switch` has no `.labels` to read the row's label). */
function SettingSwitch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id?: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow id={id} label={label} description={description}>
      <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChange} />
    </SettingRow>
  );
}

/** A card that groups the rows of one section. */
function SettingGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="divide-y divide-border rounded-xl border bg-card px-4">
      {title && (
        <div className="grid gap-1 py-3">
          <p className="text-sm font-medium">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

export { SettingGroup, SettingRow, SettingSelect, SettingSwitch };
