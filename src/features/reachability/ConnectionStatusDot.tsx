// The availability dot of one connection: what the last probe found, or unknown until then.
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/StatusDot";
import { dotStatus } from "./reachability-model";
import { useReachability } from "./store";

interface ConnectionStatusDotProps {
  /** The connection whose dot to show. */
  connectionId: string;
  className?: string;
}

/**
 The status dot of a single connection. Reads its last probe result through a stable selector (the
 stored object, unchanged until a new probe replaces it), and renders it as a translated `StatusDot`.
 */
export function ConnectionStatusDot({ connectionId, className }: ConnectionStatusDotProps) {
  const { t } = useTranslation();
  const result = useReachability((state) => state.results[connectionId]);
  const status = dotStatus(result);
  return <StatusDot status={status} label={t(`status.${status}`)} className={className} />;
}
