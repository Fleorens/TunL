import type { ComponentProps } from "react";
import { useController } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import type { ConnectionFormValues } from "./form-values";

/** A form field whose value is a plain string, so it can be bound directly to an `<input>`. */
export type StringFieldName = {
  [K in keyof ConnectionFormValues]: ConnectionFormValues[K] extends string ? K : never;
}[keyof ConnectionFormValues];

/** A text field: label, input registered with the form, and the validation message below it. */
export function StringField({
  name,
  label,
  ...inputProps
}: {
  name: StringFieldName;
  label: string;
} & Omit<ComponentProps<typeof Input>, "name" | "value" | "onChange" | "onBlur" | "ref">) {
  const form = useFormHook();
  const { field, fieldState } = useController({ name, control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} {...field} aria-invalid={fieldState.invalid} {...inputProps} />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

/** A boolean field rendered as a labelled switch. */
export function SwitchField({ name, label }: { name: keyof ConnectionFormValues; label: string }) {
  const form = useFormHook();
  const { field } = useController({ name, control: form.control });
  return (
    <label htmlFor={name} className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch
        id={name}
        checked={Boolean(field.value)}
        onCheckedChange={(value) => field.onChange(value)}
      />
    </label>
  );
}
