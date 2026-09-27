import { useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings/store";
import { useFormHook } from "./form-context";
import { StringField } from "./form-fields";
import { RdpAdvancedFields } from "./RdpAdvancedFields";

/**
 * The Advanced tab, for the edited protocol only: SSH timeouts (an empty field falls back to the global
 * setting, shown as placeholder), or the whole RDP section.
 */
export function AdvancedTab() {
  const form = useFormHook();
  const protocol = useWatch({ name: "protocol", control: form.control });
  return protocol === "rdp" ? <RdpAdvancedFields /> : <SshAdvancedFields />;
}

function SshAdvancedFields() {
  const { t } = useTranslation();
  const keepaliveGlobal = useSettings((state) => state.settings?.ssh.keepaliveSecs);
  const timeoutGlobal = useSettings((state) => state.settings?.ssh.connectTimeoutSecs);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StringField
        name="sshKeepaliveSecs"
        label={t("editor.fields.keepalive")}
        inputMode="numeric"
        placeholder={t("editor.globalDefault", { value: keepaliveGlobal })}
      />
      <StringField
        name="sshConnectTimeoutSecs"
        label={t("editor.fields.connectTimeout")}
        inputMode="numeric"
        placeholder={t("editor.globalDefault", { value: timeoutGlobal })}
      />
    </div>
  );
}
