import { useController } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import type { ConnectionFormValues } from "./form-values";

type AuthMethod = ConnectionFormValues["sshAuthMethod"];

const METHODS: readonly { value: AuthMethod; labelKey: "password" | "key" | "agent" }[] = [
  { value: "password", labelKey: "password" },
  { value: "key", labelKey: "key" },
  { value: "agent", labelKey: "agent" },
];

/** A radio rendered as a card: a native input in a label, so its accessible name is the card text. */
function AuthCard({
  value,
  label,
  checked,
  onChange,
}: {
  value: string;
  label: string;
  checked: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5">
      {/* project-rules: allow raw-form-element — native radio inside a card <label>, styled by has-checked */}
      <input
        type="radio"
        name="ssh-auth"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="size-4 accent-primary"
      />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

/** The Authentication tab: RDP gets a domain, SSH gets the auth method (radio cards) and its fields. */
export function AuthTab() {
  const { t } = useTranslation();
  const form = useFormHook();
  const protocolForm = useController({ name: "protocol", control: form.control });
  const rdpDomainForm = useController({ name: "rdpDomain", control: form.control });
  const sshAuthForm = useController({ name: "sshAuthMethod", control: form.control });
  const sshKeyPathForm = useController({ name: "sshKeyPath", control: form.control });

  if (protocolForm.field.value === "rdp") {
    const { field, fieldState } = rdpDomainForm;
    return (
      <div className="grid gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rdpDomain">{t("editor.fields.domain")}</Label>
          <Input id="rdpDomain" {...field} aria-invalid={fieldState.invalid} />
          <FieldError message={fieldState.error?.message} />
        </div>
        <p className="text-sm text-muted-foreground">{t("editor.auth.passwordHint")}</p>
      </div>
    );
  }

  const { field } = sshAuthForm;
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2">
        {METHODS.map((method) => (
          <AuthCard
            key={method.value}
            value={method.value}
            label={t(`editor.auth.${method.labelKey}`)}
            checked={field.value === method.value}
            onChange={field.onChange}
          />
        ))}
      </div>

      {field.value === "key" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sshKeyPath">{t("editor.fields.keyPath")}</Label>
          <Input
            id="sshKeyPath"
            {...sshKeyPathForm.field}
            placeholder="~/.ssh/id_ed25519"
            aria-invalid={sshKeyPathForm.fieldState.invalid}
          />
          <FieldError message={sshKeyPathForm.fieldState.error?.message} />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {field.value === "password" ? t("editor.auth.passwordHint") : t("editor.auth.agentHint")}
      </p>
    </div>
  );
}
