import { SectionHeader } from "@/components/SectionHeader";

const ROLES: { role: string; label: string; className: string; text: string }[] = [
  {
    role: "screen-title",
    label: "text-xl font-semibold tracking-tight",
    className: "text-xl font-semibold tracking-tight",
    text: "Web-01",
  },
  {
    role: "section-title",
    label: "text-xs font-medium uppercase tracking-wider text-subtle-foreground",
    className: "text-xs font-medium uppercase tracking-wider text-subtle-foreground",
    text: "Connection",
  },
  {
    role: "card-title",
    label: "text-sm font-medium",
    className: "text-sm font-medium",
    text: "Deploy job",
  },
  {
    role: "body",
    label: "text-sm",
    className: "text-sm",
    text: "Maintained and updated continuously.",
  },
  {
    role: "secondary",
    label: "text-xs text-muted-foreground",
    className: "text-xs text-muted-foreground",
    text: "10.0.0.12:22",
  },
  {
    role: "technical",
    label: "font-mono text-xs (+ tabular-nums)",
    className: "font-mono text-xs tabular-nums",
    text: "ssh -i ~/.id_ed25519 web-01",
  },
];

export function TypographySection() {
  return (
    <section className="space-y-4">
      <SectionHeader title="Typography" />
      <div className="grid gap-4 sm:grid-cols-2">
        {ROLES.map((r) => (
          <div
            key={r.role}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
          >
            <span className={r.className}>{r.text}</span>
            <code className="inline-flex w-fit font-mono text-[11px] text-subtle-foreground">
              {r.label}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}
