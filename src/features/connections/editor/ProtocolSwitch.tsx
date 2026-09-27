import { useController } from "react-hook-form";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConnections } from "@/features/connections/store";
import { useFormHook } from "./form-context";
import type { ConnectionFormValues } from "./form-values";

/**
 * The SSH / RDP switch. A single-select `ToggleGroup` whose items are radios (the e2e test clicks
 * them by role). Deselecting the active item does nothing; switching protocol replaces the port by
 * the new template's, unless the user has already touched it.
 */
export function ProtocolSwitch({ portTouched }: { portTouched: React.RefObject<boolean> }) {
  const form = useFormHook();
  const { control, setValue } = form;
  const { field } = useController({ name: "protocol", control });
  const templates = useConnections((s) => s.templates);

  const switchProtocol = (value: string) => {
    if (!value) return; // Deselecting the active item changes nothing.
    setValue("protocol", value as ConnectionFormValues["protocol"], {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (!portTouched.current) {
      const port = value === "ssh" ? templates?.ssh.port : templates?.rdp.port;
      if (port !== undefined) setValue("port", String(port), { shouldValidate: true });
    }
  };

  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1">
      <ToggleGroup type="single" value={field.value} onValueChange={switchProtocol}>
        <ToggleGroupItem value="ssh">SSH</ToggleGroupItem>
        <ToggleGroupItem value="rdp">RDP</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
