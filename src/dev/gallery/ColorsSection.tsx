import { SectionHeader } from "@/components/SectionHeader";

const SWATCHES: { name: string; bg: string }[] = [
  { name: "background", bg: "bg-background" },
  { name: "sidebar", bg: "bg-sidebar" },
  { name: "card", bg: "bg-card" },
  { name: "muted", bg: "bg-muted" },
  { name: "primary", bg: "bg-primary" },
  { name: "brand-gradient", bg: "bg-brand-gradient" },
  { name: "protocol-ssh", bg: "bg-protocol-ssh" },
  { name: "protocol-rdp", bg: "bg-protocol-rdp" },
  { name: "protocol-sftp", bg: "bg-protocol-sftp" },
  { name: "status-online", bg: "bg-status-online" },
  { name: "status-connecting", bg: "bg-status-connecting" },
  { name: "status-offline", bg: "bg-status-offline" },
  { name: "destructive", bg: "bg-destructive" },
];

export function ColorsSection() {
  return (
    <section className="space-y-4">
      <SectionHeader title="Colors" />
      <div className="flex flex-wrap gap-6">
        {SWATCHES.map((s) => (
          <div key={s.name} className="flex flex-col items-center gap-2">
            <div className={`size-14 rounded-xl border border-border ${s.bg}`} />
            <span className="font-mono text-xs text-muted-foreground">{s.name}</span>
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <p className="text-foreground">Foreground — principal</p>
        <p className="text-muted-foreground">Muted foreground — secondaire</p>
        <p className="text-subtle-foreground">Subtle foreground — tertiaire</p>
      </div>
    </section>
  );
}
