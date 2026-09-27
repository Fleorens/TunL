import { useController } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import { StringField, SwitchField } from "./form-fields";
import type { ConnectionFormValues } from "./form-values";
import { TagsInput } from "./TagsInput";

type DisplayMode = ConnectionFormValues["rdpDisplayMode"];
type Audio = ConnectionFormValues["rdpAudio"];
type CertPolicy = ConnectionFormValues["rdpCertPolicy"];

const DISPLAY_MODES: readonly { value: DisplayMode; labelKey: "fit" | "fullscreen" | "fixed" }[] = [
  { value: "fit", labelKey: "fit" },
  { value: "fullscreen", labelKey: "fullscreen" },
  { value: "fixed", labelKey: "fixed" },
];

const AUDIO_OPTIONS: readonly { value: Audio; labelKey: "local" | "remote" | "off" }[] = [
  { value: "local", labelKey: "local" },
  { value: "remote", labelKey: "remote" },
  { value: "off", labelKey: "off" },
];

const CERT_OPTIONS: readonly { value: CertPolicy; labelKey: "prompt" | "tofu" }[] = [
  { value: "prompt", labelKey: "prompt" },
  { value: "tofu", labelKey: "tofu" },
];

/** The display layout radio cards, plus the width/height fields that appear only when the size is fixed. */
function DisplayModeField() {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field } = useController({ name: "rdpDisplayMode", control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t("editor.fields.display")}</Label>
      <RadioGroup
        value={field.value}
        onValueChange={(value) => field.onChange(value as DisplayMode)}
      >
        <div className="flex flex-wrap gap-2">
          {DISPLAY_MODES.map((mode) => (
            <label
              key={mode.value}
              htmlFor={`display-${mode.value}`}
              className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50 peer-checked:border-primary peer-checked:bg-primary/5"
            >
              <RadioGroupItem id={`display-${mode.value}`} value={mode.value} />
              <span className="text-sm font-medium">{t(`editor.display.${mode.labelKey}`)}</span>
            </label>
          ))}
        </div>
      </RadioGroup>
      {field.value === "fixed" && (
        <div className="flex gap-4">
          <StringField
            name="rdpWidth"
            label={t("editor.fields.width")}
            inputMode="numeric"
            autoComplete="off"
          />
          <StringField
            name="rdpHeight"
            label={t("editor.fields.height")}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
      )}
    </div>
  );
}

/** A labelled `Select` bound to a single form field. Options live under `editor.<rootKey>.*`; the caller composes
 * the concrete key via `labelFor`, so `t()` receives an exact key union. */
function FieldSelect<LabelKey extends string>({
  name,
  label,
  options,
  labelFor,
}: {
  name: keyof ConnectionFormValues;
  label: string;
  options: readonly { value: string; labelKey: LabelKey }[];
  labelFor: (labelKey: LabelKey) => string;
}) {
  const form = useFormHook();
  const { field, fieldState } = useController({ name, control: form.control });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select value={field.value as string} onValueChange={(value) => field.onChange(value)}>
        <SelectTrigger id={name} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {labelFor(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

/** The RDP options: display layout, a few switches, audio and certificate selects, and the extra arguments. */
export function RdpAdvancedFields() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <DisplayModeField />

      <div className="flex flex-col gap-3">
        <SwitchField name="rdpMultimon" label={t("editor.fields.multimon")} />
        <SwitchField name="rdpDynamicResolution" label={t("editor.fields.dynamicResolution")} />
        <SwitchField name="rdpClipboard" label={t("editor.fields.clipboard")} />
        <SwitchField name="rdpShareHome" label={t("editor.fields.shareHome")} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldSelect
          name="rdpAudio"
          label={t("editor.fields.audio")}
          options={AUDIO_OPTIONS}
          labelFor={(labelKey) => t(`editor.audio.${labelKey}`)}
        />
        <FieldSelect
          name="rdpCertPolicy"
          label={t("editor.fields.certificate")}
          options={CERT_OPTIONS}
          labelFor={(labelKey) => t(`editor.cert.${labelKey}`)}
        />
      </div>

      <TagsInput
        name="rdpExtraArgs"
        label={t("editor.fields.extraArgs")}
        lowercase={false}
        dedupe={false}
        max={20}
      />
    </div>
  );
}
