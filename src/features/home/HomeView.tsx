import { Command, FileInput, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import { useUi } from "@/features/shell/ui-store";

export function HomeView() {
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
          <Button variant="outline" onClick={notifyComingSoon}>
            <FileInput className="size-4" />
            {t("home.importSshConfig")}
          </Button>
          <Button variant="ghost" onClick={notifyComingSoon}>
            <Command className="size-4" />
            {t("home.quickConnect")}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
