/**
 * Alle plattformabhängigen Pfade an einer Stelle. `APP_NAME` wird von
 * `scripts/init.ts` mit umbenannt — nirgends sonst darf der Name hartcodiert
 * stehen.
 */
import { join } from "@std/path";

export const APP_NAME = "Markdown-Betrachter";
/** Umgebungsvariable, mit der Tests und der Entwicklungslauf die DB umbiegen. */
export const DB_ENV = "MARKDOWN_BETRACHTER_DB";

function home(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
}

/** Nutzerdaten: SQLite-Datei, Lockdatei, Sicherungen. */
export function dataDir(): string {
  if (Deno.build.os === "windows") return join(Deno.env.get("APPDATA") ?? ".", APP_NAME);
  if (Deno.build.os === "darwin") return join(home(), "Library", "Application Support", APP_NAME);
  const base = Deno.env.get("XDG_DATA_HOME") ?? join(home(), ".local", "share");
  return join(base, APP_NAME);
}

/** Protokolldateien — auf macOS bewusst nicht im Datenordner (`~/Library/Logs`). */
export function logDir(): string {
  if (Deno.build.os === "windows") return join(Deno.env.get("LOCALAPPDATA") ?? ".", APP_NAME, "logs");
  if (Deno.build.os === "darwin") return join(home(), "Library", "Logs", APP_NAME);
  const base = Deno.env.get("XDG_STATE_HOME") ?? join(home(), ".local", "state");
  return join(base, APP_NAME, "logs");
}

export function databasePath(): string {
  return Deno.env.get(DB_ENV) ?? join(dataDir(), "data.db");
}

export function logPath(): string {
  return join(logDir(), "app.log");
}

export function downloadsDir(): string {
  return join(home(), Deno.build.os === "windows" ? "Downloads" : "Downloads");
}
