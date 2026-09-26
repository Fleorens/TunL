import { useTranslation } from "react-i18next";
import { ProtocolBadge } from "@/components/ProtocolBadge";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { SectionHeader } from "@/components/SectionHeader";
import { ShortcutHint } from "@/components/ShortcutHint";
import { type Status, StatusDot } from "@/components/StatusDot";

const STATES: { status: Status }[] = [
  { status: "online" },
  { status: "connecting" },
  { status: "offline" },
  { status: "error" },
  { status: "unknown" },
];

export function AtomsSection() {
  const { t } = useTranslation();

  return (
    <section className="space-y-6">
      <SectionHeader title="Atoms" />

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="space-y-2">
          {STATES.map((s) => (
            <div key={s.status} className="flex items-center gap-2">
              <StatusDot status={s.status} label={t(`status.${s.status}`)} />
              <span className="text-sm">{t(`status.${s.status}`)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card p-4">
        {(["ssh", "rdp", "sftp"] as const).map((protocol) => (
          <div key={protocol} className="flex items-center gap-2">
            <ProtocolBadge protocol={protocol} />
            <ProtocolIcon protocol={protocol} />
          </div>
        ))}
        <ShortcutHint keys={["Ctrl", "Shift", "P"]} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 transition duration-120 ease-out-soft hover:-translate-y-px hover:border-border-strong hover:shadow-elevated">
        <div className="flex items-center gap-2">
          <ProtocolBadge protocol="ssh" />
          <StatusDot status="online" label={t("status.online")} />
          <span className="font-medium">web-01</span>
        </div>
        <span className="mt-1 block font-mono text-xs text-muted-foreground">
          deploy@10.0.0.12:22
        </span>
      </div>
    </section>
  );
}
