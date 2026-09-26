import { Command, FileInput, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const ComingSoon = () => toast("shell.notYetAvailable");

export function HomeView() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Empty>
        <EmptyMedia className="rounded-2xl bg-brand-gradient/10 p-4">
          <Logo size={40} />
        </EmptyMedia>
        <EmptyTitle>{t("home.welcomeTitle")}</EmptyTitle>
        <EmptyDescription>{t("home.welcomeDescription")}</EmptyDescription>
        <EmptyContent className="flex gap-2 flex-wrap items-center justify-center">
          <Button onClick={ComingSoon}>
            <Plus className="size-4" />
            {t("home.newConnection")}
          </Button>
          <Button variant="outline" onClick={ComingSoon}>
            <FileInput className="size-4" />
            {t("home.importSshConfig")}
          </Button>
          <Button variant="ghost" onClick={ComingSoon}>
            <Command className="size-4" />
            {t("home.quickConnect")}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
