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

/** The label and its help on the left, the control on the right. */
function SettingRow({
  id,
  label,
  description,
  children,
}: {
  id?: string;
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="grid gap-1">
        {id ? (
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      {children}
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
          onChange(chosen ? chosen.value : value);
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
function SettingGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-xl border bg-card px-4">
      {title && <p className="py-3 text-sm font-medium">{title}</p>}
      {children}
    </div>
  );
}

export { SettingGroup, SettingRow, SettingSelect, SettingSwitch };
