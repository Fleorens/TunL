// The SFTP tab's top line: up, refresh, the path (breadcrumb or a typed field), new folder, and the hidden-files
// toggle.
import {
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  FolderUp,
  Pencil,
  RefreshCw,
  SquareTerminal,
  Upload,
} from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { pathSegments } from "./sftp-model";

interface SftpToolbarProps {
  path: string;
  showHidden: boolean;
  onUp: () => void;
  onRefresh: () => void;
  onNavigate: (target: string) => void;
  onToggleHidden: (showHidden: boolean) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onUploadFolder: () => void;
  onOpenTerminal: () => void;
  busy: boolean;
}

/** The path as a clickable breadcrumb: one item per segment, the last is the page, separators between the rest. */
function BreadcrumbPath({
  segments,
  onNavigate,
}: {
  segments: { name: string; path: string }[];
  onNavigate: (target: string) => void;
}) {
  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="font-mono text-xs">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          // No separator between the root `/` and the first folder.
          const showSeparator = index > 0 && !(index === 1 && segments[0].name === "/");
          return (
            <Fragment key={segment.path}>
              {showSeparator && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{segment.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      aria-label={segment.name}
                      onClick={() => onNavigate(segment.path)}
                    >
                      {segment.name}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function SftpToolbar({
  path,
  showHidden,
  onUp,
  onRefresh,
  onNavigate,
  onToggleHidden,
  onNewFolder,
  onUpload,
  onUploadFolder,
  onOpenTerminal,
  busy,
}: SftpToolbarProps) {
  const { t } = useTranslation();
  const segments = pathSegments(path);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(path);

  const startEdit = (): void => {
    setValue(path);
    setEditing(true);
  };
  const commitEdit = (): void => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed) onNavigate(trimmed);
  };
  const cancelEdit = (): void => setEditing(false);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-card px-2">
      <IconButton variant="outline" size="sm" label={t("sftp.up")} onClick={onUp}>
        <ArrowUp className="size-4" />
      </IconButton>
      {busy ? (
        <span className="inline-flex size-7 items-center justify-center">
          <Spinner aria-label={t("sftp.working")} />
        </span>
      ) : (
        <IconButton variant="outline" size="sm" label={t("sftp.refresh")} onClick={onRefresh}>
          <RefreshCw className="size-4" />
        </IconButton>
      )}
      <div className="flex min-w-0 flex-1 items-center">
        {editing ? (
          <Input
            value={value}
            autoFocus
            aria-label={t("sftp.path")}
            className="h-7 min-w-0 font-mono text-xs"
            onChange={(event) => setValue(event.target.value)}
            onBlur={cancelEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEdit();
              else if (event.key === "Escape") cancelEdit();
            }}
          />
        ) : (
          <BreadcrumbPath segments={segments} onNavigate={onNavigate} />
        )}
      </div>
      <IconButton variant="outline" size="sm" label={t("sftp.editPath")} onClick={startEdit}>
        <Pencil className="size-4" />
      </IconButton>
      <IconButton variant="outline" size="sm" label={t("sftp.upload")} onClick={onUpload}>
        <Upload className="size-4" />
      </IconButton>
      <IconButton
        variant="outline"
        size="sm"
        label={t("sftp.uploadFolder")}
        onClick={onUploadFolder}
      >
        <FolderUp className="size-4" />
      </IconButton>
      <IconButton
        variant="outline"
        size="sm"
        label={t("sftp.menu.newFolder")}
        onClick={onNewFolder}
      >
        <FolderPlus className="size-4" />
      </IconButton>
      <IconButton
        variant="outline"
        size="sm"
        label={t("sftp.openTerminal")}
        onClick={onOpenTerminal}
      >
        <SquareTerminal className="size-4" />
      </IconButton>
      <Toggle
        size="sm"
        aria-label={t("sftp.showHidden")}
        pressed={showHidden}
        onPressedChange={onToggleHidden}
      >
        {showHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Toggle>
    </div>
  );
}
