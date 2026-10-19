// Send a connection's Wake-on-LAN magic packet from the menu (T29). Fire and forget: success says so, a
// refusal is reported like any other failed IPC call.

import { toast } from "sonner";
import type { Connection } from "@/bindings/Connection";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

/** Send `connection`'s magic packet, and tell the user it went out (or why it did not). */
export async function wakeConnection(connection: Connection): Promise<void> {
  const { id, name } = connection;
  try {
    await ipc.wolWake(id);
    toast(i18n.t("connectionMenu.wakeSent", { name }));
  } catch (error) {
    notifyError(error);
  }
}
