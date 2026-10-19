// Mock handlers for the SFTP commands (T24): a tab goes through the same connecting steps as a shell,
// then works on one in-memory file system shared by every tab (a folder created in one shows in the
// other, as on a real server). T25 and T25b are built against it.
import type { AppError } from "@/bindings/AppError";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import type { Handler, MockState } from "./data";
import { arg } from "./data";
import type { LiveSession, ResolvedTarget } from "./sessions";
import { connectSteps, resolveTarget, scheduler, sessions } from "./sessions";
import * as sftpFs from "./sftp-fs";

type Result = { state: MockState; result: unknown };

/** The file system every SFTP tab sees. */
let fs: sftpFs.MockFs = sftpFs.demoFs();

/** The home directory of each connected SFTP tab, by tab id. */
const homes = new Map<string, string>();

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

/** The home of a connected tab; a tab not (or no longer) connected has no session. */
function homeOf(sessionId: string): string {
  const home = homes.get(sessionId);
  if (home === undefined || !sessions.has(sessionId)) {
    throw {
      kind: "notFound",
      message: `sftp session ${sessionId}`,
      detail: null,
    } satisfies AppError;
  }
  return home;
}

/** The connecting steps, then the `open` step of the sftp subsystem and `connected`. */
async function runSftp(session: LiveSession, target: ResolvedTarget): Promise<void> {
  const { event } = scheduler(session);
  if (!(await connectSteps(session, target))) return;
  await event({ type: "step", step: "open", label: "sftp", state: "started" });
  await event({ type: "step", step: "open", label: "sftp", state: "done" });
  if (!sessions.has(session.id)) return;
  fs = sftpFs.withHome(fs, target.user);
  homes.set(session.id, `/home/${target.user}`);
  await event({ type: "connected" });
}

function open(state: MockState, args: Record<string, unknown>): Result {
  const { sessionId, target, onEvent } = arg<{
    sessionId: string;
    target: SessionTarget;
    onEvent: (event: SessionEvent) => void;
  }>(args);
  // Refusals: nothing starts, no event is emitted.
  if (sessions.has(sessionId)) throw validation("is already open");
  const resolved = resolveTarget(state, target);

  // The shell fields are unused by an SFTP tab.
  const session: LiveSession = {
    id: sessionId,
    callbacks: { onEvent, onOutput: () => {} },
    prompt: "",
    line: "",
    cols: 0,
    rows: 0,
    timers: [],
  };
  homes.delete(sessionId);
  sessions.set(sessionId, session);
  // The steps run in the background; the command answers at once, like the backend.
  void runSftp(session, resolved);
  return { state, result: null };
}

/** A command on a connected tab: `run` reads the shared file system and returns the result. */
function onTab<A extends { sessionId: string }>(run: (args: A, home: string) => unknown) {
  return (state: MockState, args: Record<string, unknown>): Result => {
    const typed = arg<A>(args);
    return { state, result: run(typed, homeOf(typed.sessionId)) };
  };
}

type PathArgs = { sessionId: string; path: string };

export const sftpHandlers: Record<string, Handler<Record<string, unknown>>> = {
  sftp_open: open,
  sftp_realpath: onTab<PathArgs>(({ path }, home) => sftpFs.realpath(fs, path, home)),
  sftp_list: onTab<PathArgs>(({ path }) => sftpFs.list(fs, path)),
  sftp_mkdir: onTab<PathArgs>(({ path }) => {
    fs = sftpFs.mkdir(fs, path);
    return null;
  }),
  sftp_rename: onTab<{ sessionId: string; from: string; to: string }>(({ from, to }) => {
    fs = sftpFs.rename(fs, from, to);
    return null;
  }),
  sftp_count: onTab<PathArgs>(({ path }) => sftpFs.count(fs, path)),
  sftp_remove: onTab<PathArgs>(({ path }) => {
    fs = sftpFs.remove(fs, path);
    return null;
  }),
  sftp_chmod: onTab<PathArgs & { mode: number }>(({ path, mode }) => {
    fs = sftpFs.chmod(fs, path, mode);
    return null;
  }),
};

/** Back to the demo file system with no connected tab, for `resetMockBackend()`. */
export function resetMockSftp(): void {
  fs = sftpFs.demoFs();
  homes.clear();
}
