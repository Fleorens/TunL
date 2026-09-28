import { Command, FileInput, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/bindings/Connection";
import { Logo } from "@/components/Logo";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { SectionHeader } from "@/components/SectionHeader";
import { ShortcutHint } from "@/components/ShortcutHint";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { openImport } from "@/features/connections/open-import";
import { useConnections } from "@/features/connections/store";
import { parseQuickConnect } from "@/features/palette/quick-connect";
import { openQuickSession, openSession } from "@/features/sessions/open-session";
import { SHORTCUTS } from "@/features/shell/shortcuts";
import { useUi } from "@/features/shell/ui-store";
import { ConnectionCard } from "./ConnectionCard";
import {
  bastionName,
  connectionAddress,
  favoriteConnections,
  formatRelativeTime,
  greetingFor,
  recentConnections,
} from "./home-model";

/** The first-launch screen, shown when there is no connection yet. */
function EmptyWelcome() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Empty>
        <EmptyHeader>
          <EmptyMedia className="mb-2 rounded-2xl bg-brand-soft p-4">
            <Logo size={40} />
          </EmptyMedia>
          <EmptyTitle className="text-xl font-semibold tracking-tight">
            {t("home.welcomeTitle")}
          </EmptyTitle>
          <EmptyDescription>{t("home.welcomeDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-none flex-row flex-wrap justify-center gap-2">
          <Button onClick={() => useUi.getState().openEditor({ mode: "create" })}>
            <Plus className="size-4" />
            {t("home.newConnection")}
          </Button>
          <Button variant="outline" onClick={() => openImport()}>
            <FileInput className="size-4" />
            {t("home.importSshConfig")}
          </Button>
          <Button variant="ghost" onClick={() => useUi.getState().openPalette("quickConnect")}>
            <Command className="size-4" />
            {t("home.quickConnect")}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

/** Two placeholder lines while the store loads. */
function LoadingLines() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-8">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function HomeView() {
  const status = useConnections((state) => state.status);
  const connections = useConnections((state) => state.connections);

  if (status === "idle" || status === "loading") return <LoadingLines />;
  if (connections.length === 0) return <EmptyWelcome />;

  return <Dashboard connections={connections} />;
}

interface DashboardProps {
  connections: readonly Connection[];
}

function Dashboard({ connections }: DashboardProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  // Read the clock once: no timer in this screen.
  const now = new Date();
  const greeting = greetingFor(now.getHours());
  const favorites = favoriteConnections(connections);
  const recents = recentConnections(connections);

  function submit() {
    const target = parseQuickConnect(value);
    if (target) {
      openQuickSession(target);
      setValue("");
      setInvalid(false);
    } else {
      setInvalid(true);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(`home.greeting.${greeting}`)}
        <span className="mt-1 block text-base font-normal text-muted-foreground">
          {t("home.count", { count: connections.length })}
        </span>
      </h1>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
        <Input
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={t("home.quickPlaceholder")}
          aria-label={t("home.quickPlaceholder")}
          className="h-12 rounded-xl bg-muted pl-10 pr-10 text-lg"
        />
        <Kbd className="absolute top-1/2 right-3 -translate-y-1/2">⏎</Kbd>
      </div>
      {invalid && <p className="text-sm text-muted-foreground">{t("home.quickInvalid")}</p>}

      {favorites.length > 0 && (
        <section>
          <SectionHeader title={t("home.favorites")} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {favorites.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                jumpHostName={bastionName(connection, connections)}
              />
            ))}
          </div>
        </section>
      )}

      {recents.length > 0 && (
        <section aria-label={t("home.recent")}>
          <SectionHeader title={t("home.recent")} />
          <div className="flex flex-col">
            {recents.map((connection) => (
              <RecentRow key={connection.id} connection={connection} now={now.getTime()} />
            ))}
          </div>
        </section>
      )}

      <Hints />
    </div>
  );
}

/** A recent connection: protocol icon, name, address, relative time. Clicking connects. */
function RecentRow({ connection, now }: { connection: Connection; now: number }) {
  const { t, i18n } = useTranslation();
  const protocol = connection.settings.protocol;
  const relative = formatRelativeTime(connection.lastConnectedAt ?? 0, now, i18n.language);

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted"
      aria-label={t("home.card.connect", { name: connection.name })}
      onClick={() => openSession(connection)}
    >
      <ProtocolIcon protocol={protocol} />
      <span className="flex-1 truncate font-medium">{connection.name}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {connectionAddress(connection)}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">{relative}</span>
    </button>
  );
}

/** The three footer hints: a shortcut key next to its label. */
function Hints() {
  const { t } = useTranslation();
  const items: { keys: readonly string[]; label: string }[] = [
    { keys: shortcutKeys("palette.open"), label: t("home.hints.palette") },
    { keys: shortcutKeys("connection.new"), label: t("home.hints.newConnection") },
    { keys: shortcutKeys("help.shortcuts"), label: t("home.hints.shortcuts") },
  ];

  return (
    <ul className="flex flex-col gap-2 pt-2">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center justify-between gap-4 px-2 text-sm text-muted-foreground"
        >
          <ShortcutHint keys={item.keys} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** The displayed keys for a shortcut id, falling back to an empty list. */
function shortcutKeys(id: (typeof SHORTCUTS)[number]["id"]) {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.display ?? [];
}
