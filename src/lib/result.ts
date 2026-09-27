// A discriminated union for fallible operations. `ok: true` carries a value,
// `ok: false` carries an `AppError`. Mirrors the Rust `Result` returned by IPC.
import type { AppError } from "@/bindings/AppError";

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
