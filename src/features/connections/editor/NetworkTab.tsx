import { useMemo } from "react";
import { useController } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConnections } from "@/features/connections/store";
import { eligibleJumpHosts, jumpChainNames } from "../jump-hosts";
import { FieldError } from "./FieldError";
import { useFormHook } from "./form-context";
import { StringField, SwitchField } from "./form-fields";

/** The sentinel for « no jump host », like the group selector: an empty `value` is not allowed on a `SelectItem`. */
const NONE = "__none__";

/** The jump host selector, plus the chain it produces, from the user's side. */
function JumpHost({ selfId }: { selfId: string | null }) {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field, fieldState } = useController({ name: "jumpHostId", control: form.control });
  const name = useController({ name: "name", control: form.control }).field.value ?? "";
  const connections = useConnections((state) => state.connections);

  const eligible = useMemo(() => eligibleJumpHosts(connections, selfId), [connections, selfId]);
  const chain = useMemo(() => {
    if (field.value === "") return null;
    return [
      t("editor.chainYou"),
      ...jumpChainNames(connections, field.value),
      name.trim() || t("editor.chainThisConnection"),
    ];
  }, [connections, field.value, name, t]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="jumpHost">{t("editor.fields.jumpHost")}</Label>
      <Select
        value={field.value || NONE}
        onValueChange={(value) => field.onChange(value === NONE ? "" : value)}
      >
        <SelectTrigger id="jumpHost">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("editor.noJumpHost")}</SelectItem>
          {eligible.map((connection) => (
            <SelectItem key={connection.id} value={connection.id}>
              {connection.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={fieldState.error?.message} />
      {chain && (
        <p className="flex flex-wrap items-center gap-x-1 text-sm">
          {chain.map((part, index) => (
            <span key={part} className="text-foreground">
              {part}
              {index < chain.length - 1 && <span className="text-muted-foreground"> → </span>}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** The Wake-on-LAN section: a switch that reveals the MAC, broadcast, UDP port and wait-timeout fields. */
function WakeOnLan() {
  const { t } = useTranslation();
  const form = useFormHook();
  const { field: enabled } = useController({ name: "wolEnabled", control: form.control });

  return (
    <div className="rounded-lg border border-input p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("editor.fields.wol")}</Label>
        <Switch
          checked={enabled.value}
          onCheckedChange={enabled.onChange}
          aria-label={t("editor.fields.wol")}
        />
      </div>
      {enabled.value && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <StringField
            name="wolMac"
            label={t("editor.fields.mac")}
            inputMode="text"
            autoComplete="off"
          />
          <StringField
            name="wolBroadcast"
            label={t("editor.fields.broadcast")}
            inputMode="text"
            autoComplete="off"
          />
          <StringField
            name="wolPort"
            label={t("editor.fields.wolPort")}
            inputMode="numeric"
            autoComplete="off"
          />
          <StringField
            name="wolWaitTimeoutSecs"
            label={t("editor.fields.waitTimeout")}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
      )}
      {enabled.value && (
        <div className="mt-3">
          <SwitchField name="wolWakeBeforeConnect" label={t("editor.fields.wakeBeforeConnect")} />
        </div>
      )}
    </div>
  );
}

export function NetworkTab({ selfId }: { selfId: string | null }) {
  return (
    <div className="grid gap-4">
      <JumpHost selfId={selfId} />
      <WakeOnLan />
    </div>
  );
}
