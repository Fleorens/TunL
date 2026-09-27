import { describe, expect, it } from "vitest";
import type { AppError } from "@/bindings/AppError";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import {
  backendFieldError,
  type ConnectionFormValues,
  connectionFormSchema,
  toConnectionInput,
  toFormValues,
} from "./form-values";

const common = {
  name: "",
  host: "",
  username: null,
  groupId: null,
  tags: [],
  favorite: false,
  color: null,
  notes: null,
  jumpHostId: null,
  wol: null,
} satisfies Partial<ConnectionInput>;

const templates: ConnectionTemplates = {
  ssh: {
    ...common,
    port: 22,
    settings: {
      protocol: "ssh",
      auth: { method: "password" },
      keepaliveSecs: null,
      connectTimeoutSecs: null,
    },
  },
  rdp: {
    ...common,
    port: 3389,
    settings: {
      protocol: "rdp",
      domain: null,
      display: { mode: "fit" },
      multimon: false,
      dynamicResolution: true,
      clipboard: true,
      audio: "local",
      shareHome: false,
      certPolicy: "prompt",
      extraArgs: [],
    },
  },
  wol: {
    mac: "",
    broadcast: "255.255.255.255",
    port: 9,
    wakeBeforeConnect: false,
    waitTimeoutSecs: 120,
  },
};

const richSsh: ConnectionInput = {
  ...templates.ssh,
  name: "db-prod",
  host: "db.internal",
  port: 2222,
  username: "root",
  groupId: "g-1",
  tags: ["prod", "pg"],
  favorite: true,
  color: "violet",
  notes: "primary database",
  jumpHostId: "j-1",
  settings: {
    protocol: "ssh",
    auth: { method: "key", path: "~/.ssh/id_ed25519" },
    keepaliveSecs: 30,
    connectTimeoutSecs: null,
  },
};

function valid(patch: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...toFormValues(templates.ssh, templates), name: "web-01", host: "10.0.0.12", ...patch };
}

function issuesOf(values: ConnectionFormValues): Record<string, string> {
  const result = connectionFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe("form values", () => {
  it("round-trips a connection input", () => {
    expect(toConnectionInput(toFormValues(richSsh, templates), richSsh, templates)).toEqual(
      richSsh,
    );
  });

  it("fills the form with strings, never null", () => {
    expect(toFormValues(templates.ssh, templates)).toMatchObject({
      protocol: "ssh",
      name: "",
      port: "22",
      username: "",
      groupId: "",
      color: "",
      notes: "",
      sshAuthMethod: "password",
      sshKeyPath: "",
      rdpDomain: "",
    });
  });

  it("turns empty fields into null and trims text", () => {
    const values = valid({ name: "  web-01 ", username: "  ", notes: " ", port: "2222" });
    expect(toConnectionInput(values, templates.ssh, templates)).toMatchObject({
      name: "web-01",
      username: null,
      groupId: null,
      color: null,
      notes: null,
      port: 2222,
    });
  });

  it("takes the settings of a new protocol from its template", () => {
    const input = toConnectionInput(
      valid({ protocol: "rdp", rdpDomain: " CORP " }),
      richSsh,
      templates,
    );
    expect(input.settings).toEqual({ ...templates.rdp.settings, domain: "CORP" });
  });

  it("builds the SSH authentication from the chosen method", () => {
    const withKey = toConnectionInput(
      valid({ sshAuthMethod: "key", sshKeyPath: " ~/.ssh/id " }),
      templates.ssh,
      templates,
    );
    expect(withKey.settings).toMatchObject({
      protocol: "ssh",
      auth: { method: "key", path: "~/.ssh/id" },
    });
    const agent = toConnectionInput(
      valid({ sshAuthMethod: "agent", sshKeyPath: "~/.ssh/id" }),
      templates.ssh,
      templates,
    );
    expect(agent.settings).toMatchObject({ protocol: "ssh", auth: { method: "agent" } });
  });
});

describe("form schema", () => {
  it("accepts a minimal valid connection", () => {
    expect(issuesOf(valid())).toEqual({});
  });

  it("requires a name, bounded and without control characters", () => {
    expect(issuesOf(valid({ name: "  " }))).toEqual({ name: "required" });
    expect(issuesOf(valid({ name: "a\tb" }))).toEqual({ name: "controlChars" });
    expect(issuesOf(valid({ name: "x".repeat(81) }))).toEqual({ name: "tooLong" });
  });

  it("checks the host like the backend does", () => {
    for (const host of ["10.0.0.12", "fe80::1", "db.internal", "my_host-01.example.com"]) {
      expect(issuesOf(valid({ host }))).toEqual({});
    }
    for (const host of ["bad host", "user@host", "a/b", "-lead.example", "a..b", "[::1]"]) {
      expect(issuesOf(valid({ host }))).toEqual({ host: "invalidHost" });
    }
    expect(issuesOf(valid({ host: "" }))).toEqual({ host: "required" });
  });

  it("checks the port", () => {
    for (const port of ["0", "65536", "22a", "", "-1"]) {
      expect(issuesOf(valid({ port }))).toEqual({ port: "invalidPort" });
    }
  });

  it("checks tags", () => {
    expect(issuesOf(valid({ tags: ["no spaces"] }))).toEqual({ tags: "invalidTag" });
    const eleven = Array.from({ length: 11 }, (_, index) => `t${index}`);
    expect(issuesOf(valid({ tags: eleven }))).toEqual({ tags: "tooManyTags" });
  });

  it("requires a usable key path only for key authentication", () => {
    expect(issuesOf(valid({ sshAuthMethod: "key", sshKeyPath: "" }))).toEqual({
      sshKeyPath: "required",
    });
    expect(issuesOf(valid({ sshAuthMethod: "key", sshKeyPath: "id_rsa" }))).toEqual({
      sshKeyPath: "invalidPath",
    });
    expect(issuesOf(valid({ sshAuthMethod: "key", sshKeyPath: "~/.ssh/id_ed25519" }))).toEqual({});
    expect(issuesOf(valid({ sshAuthMethod: "password", sshKeyPath: "id_rsa" }))).toEqual({});
  });

  it("ignores the SSH fields of an RDP connection", () => {
    expect(issuesOf(valid({ protocol: "rdp", sshAuthMethod: "key", sshKeyPath: "" }))).toEqual({});
    expect(issuesOf(valid({ protocol: "rdp", rdpDomain: "CO\nRP" }))).toEqual({
      rdpDomain: "controlChars",
    });
  });
});

describe("backend errors", () => {
  it("attaches a backend validation error to its form field", () => {
    const error: AppError = {
      kind: "validation",
      message: "settings.auth.path: must be absolute",
      detail: null,
    };
    expect(backendFieldError(error)).toEqual({ field: "sshKeyPath", message: "must be absolute" });
    const host: AppError = { ...error, message: "host: invalid host name" };
    expect(backendFieldError(host)).toEqual({ field: "host", message: "invalid host name" });
  });

  it("leaves the other errors to a toast", () => {
    expect(backendFieldError({ kind: "io", message: "name: disk full", detail: null })).toBeNull();
    expect(
      backendFieldError({
        kind: "validation",
        message: "ids: must list every group",
        detail: null,
      }),
    ).toBeNull();
  });
});
