import { useController } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/features/settings/store";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import { RdpAdvancedFields } from "./RdpAdvancedFields";

/** The Advanced tab: SSH timeouts (with the global setting as placeholder) and the whole RDP section. */
export function AdvancedTab() {
  const { t } = useTranslation();
  const form = useFormHook();
  const keepaliveGlobal = useSettings((state) => state.settings?.ssh.keepaliveSecs);
  const timeoutGlobal = useSettings((state) => state.settings?.ssh.connectTimeoutSecs);
  const { field: keepalive, fieldState: keepaliveState } = useController({
    name: "sshKeepaliveSecs",
    control: form.control,
  });
  const { field: timeout, fieldState: timeoutState } = useController({
    name: "sshConnectTimeoutSecs",
    control: form.control,
  });

  const keepalivePlaceholder =
    keepalive.value === "" ? t("editor.globalDefault", { value: keepaliveGlobal }) : undefined;
  const timeoutPlaceholder =
    timeout.value === "" ? t("editor.globalDefault", { value: timeoutGlobal }) : undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sshKeepaliveSecs">{t("editor.fields.keepalive")}</Label>
        <InputNumber
          id="sshKeepaliveSecs"
          value={keepalive.value}
          onChange={keepalive.onChange}
          onBlur={keepalive.onBlur}
          placeholder={keepalivePlaceholder}
          aria-invalid={keepaliveState.invalid}
        />
        <FieldError message={keepaliveState.error?.message} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sshConnectTimeoutSecs">{t("editor.fields.connectTimeout")}</Label>
        <InputNumber
          id="sshConnectTimeoutSecs"
          value={timeout.value}
          onChange={timeout.onChange}
          onBlur={timeout.onBlur}
          placeholder={timeoutPlaceholder}
          aria-invalid={timeoutState.invalid}
        />
        <FieldError message={timeoutState.error?.message} />
      </div>
      <RdpAdvancedFields />
    </div>
  );
}

/** A numeric text field, bound to a form field. */
function InputNumber({
  id,
  value,
  onChange,
  onBlur,
  ...props
}: React.ComponentProps<"input"> & {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      {...props}
    />
  );
}
