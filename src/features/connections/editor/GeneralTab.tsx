import type { ComponentProps, RefObject } from "react";
import { useState } from "react";
import { useController } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { AccentColor } from "@/bindings/AccentColor";
import type { Group } from "@/bindings/Group";
import type { GroupInput } from "@/bindings/GroupInput";
import { ColorPicker } from "@/components/ColorPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConnections } from "@/features/connections/store";
import { GroupDialog } from "@/features/shell/sidebar/GroupDialog";
import type { Result } from "@/lib/result";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import type { ConnectionFormValues } from "./form-values";
import { TagsInput } from "./TagsInput";

const NONE = "__none__";
const NEW = "__new__";

/** A form field whose value is a plain string, so it can be bound directly to an `<input>`. */
type StringField = {
  [K in keyof ConnectionFormValues]: ConnectionFormValues[K] extends string ? K : never;
}[keyof ConnectionFormValues];

/** A text field: label, input registered with the form, and the validation message below it. */
function TextField({
  name,
  label,
  required,
  ...inputProps
}: {
  name: StringField;
  label: string;
  required?: boolean;
} & Omit<ComponentProps<typeof Input>, "name" | "value" | "onChange" | "onBlur" | "ref">) {
  const form = useFormHook();
  const { field, fieldState } = useController({ name, control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={name}
        className={required ? "after:ml-0.5 after:text-destructive after:content-['*']" : undefined}
      >
        {label}
      </Label>
      <Input id={name} {...field} aria-invalid={fieldState.invalid} {...inputProps} />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

/** The port field. Typing in it marks the port touched, so switching protocol stops overwriting it. */
function PortField({ portTouched }: { portTouched: RefObject<boolean> }) {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field, fieldState } = useController({ name: "port", control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="port">{t("editor.fields.port")}</Label>
      <Input
        id="port"
        type="number"
        inputMode="numeric"
        {...field}
        onChange={(event) => {
          portTouched.current = true;
          field.onChange(event);
        }}
        aria-invalid={fieldState.invalid}
      />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

/** The notes field, a multi-line textarea. */
function NotesField() {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field, fieldState } = useController({ name: "notes", control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="notes">{t("editor.fields.notes")}</Label>
      <Textarea id="notes" rows={3} {...field} aria-invalid={fieldState.invalid} />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

/** The color picker, converting the form's `""` to the picker's `null`. */
function ColorField() {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field, fieldState } = useController({ name: "color", control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t("editor.fields.color")}</Label>
      <ColorPicker
        value={(field.value ?? "") === "" ? null : (field.value as AccentColor)}
        onChange={(color: AccentColor | null) => field.onChange(color ?? "")}
      />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

/** The group selector: a `Select` over the groups, plus « New group… » opening the T09 dialog. */
function GroupSelect() {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field, fieldState } = useController({ name: "groupId", control: form.control });
  const groups = useConnections((s) => s.groups);
  const [dialogOpen, setDialogOpen] = useState(false);

  const createGroup = async (input: GroupInput, _id: string | null): Promise<Result<Group>> => {
    const result = await useConnections.getState().createGroup(input);
    if (result.ok) field.onChange(result.value.id);
    return result;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="group">{t("editor.fields.group")}</Label>
      <Select
        value={field.value || NONE}
        onValueChange={(value) => {
          if (value === NEW) {
            setDialogOpen(true);
            return;
          }
          field.onChange(value === NONE ? "" : value);
        }}
      >
        <SelectTrigger id="group">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("editor.noGroup")}</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW}>{t("editor.newGroup")}</SelectItem>
        </SelectContent>
      </Select>
      <FieldError message={fieldState.error?.message} />
      <GroupDialog
        open={dialogOpen}
        mode="create"
        initialId={null}
        initialName=""
        initialColor={null}
        onCommit={createGroup}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

export function GeneralTab({ portTouched }: { portTouched: RefObject<boolean> }) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-3">
        <div className="w-full flex-1">
          <TextField name="name" label={t("editor.fields.name")} required />
        </div>
        <div className="w-full flex-1">
          <TextField name="host" label={t("editor.fields.host")} required />
        </div>
        <div className="w-[8rem] shrink-0">
          <PortField portTouched={portTouched} />
        </div>
      </div>
      <TextField name="username" label={t("editor.fields.username")} />
      <GroupSelect />
      <TagsInput />
      <ColorField />
      <NotesField />
    </div>
  );
}
