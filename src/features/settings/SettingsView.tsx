// The Settings tab body: a section list on the left, the chosen section on the right. Only the active tab is
// painted (the shell hides it with `hidden`); each section is one card, rendered by its own component.

import type { LucideIcon } from "lucide-react";
import {
  DatabaseBackup,
  FolderTree,
  Info,
  KeyRound,
  Monitor,
  Palette,
  Radar,
  SquareTerminal,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AboutSection } from "@/features/settings/sections/AboutSection";
import { AppearanceSection } from "@/features/settings/sections/AppearanceSection";
import { AvailabilitySection } from "@/features/settings/sections/AvailabilitySection";
import { BackupSection } from "@/features/settings/sections/BackupSection";
import { RdpSection } from "@/features/settings/sections/RdpSection";
import { SftpSection } from "@/features/settings/sections/SftpSection";
import { SshSection } from "@/features/settings/sections/SshSection";
import { TerminalSection } from "@/features/settings/sections/TerminalSection";
import { cn } from "@/lib/utils";

/** The sections of the Settings tab, in display order. */
export const SETTINGS_SECTIONS = [
  "appearance",
  "terminal",
  "ssh",
  "sftp",
  "rdp",
  "availability",
  "backup",
  "about",
] as const;
type SectionKey = (typeof SETTINGS_SECTIONS)[number];

const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  appearance: Palette,
  terminal: SquareTerminal,
  ssh: KeyRound,
  sftp: FolderTree,
  rdp: Monitor,
  availability: Radar,
  backup: DatabaseBackup,
  about: Info,
};

const SECTION_COMPONENTS: Record<SectionKey, ComponentType> = {
  appearance: AppearanceSection,
  terminal: TerminalSection,
  ssh: SshSection,
  sftp: SftpSection,
  rdp: RdpSection,
  availability: AvailabilitySection,
  backup: BackupSection,
  about: AboutSection,
};

function SectionButton({
  section,
  title,
  active,
  onSelect,
}: {
  section: SectionKey;
  title: string;
  active: boolean;
  onSelect: (section: SectionKey) => void;
}) {
  const Icon = SECTION_ICONS[section];
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-accent",
        active && "bg-accent",
      )}
      onClick={() => onSelect(section)}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{title}</span>
    </button>
  );
}

export function SettingsView({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<SectionKey>("appearance");
  const Section = SECTION_COMPONENTS[open];

  return (
    <section aria-label={t("settings.title")} hidden={!active} className="flex h-full min-h-0">
      <nav
        aria-label={t("settings.sectionsLabel")}
        className="flex w-50 flex-col gap-1 border-r p-3"
      >
        {SETTINGS_SECTIONS.map((section) => (
          <SectionButton
            key={section}
            section={section}
            title={t(`settings.sections.${section}`)}
            active={section === open}
            onSelect={setOpen}
          />
        ))}
      </nav>
      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-180 flex-col gap-4 p-6">
          <h1 className="text-xl font-semibold tracking-tight">{t(`settings.sections.${open}`)}</h1>
          <Section />
        </div>
      </ScrollArea>
    </section>
  );
}
