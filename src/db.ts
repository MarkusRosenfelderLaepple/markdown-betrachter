/**
 * Verbindung + Migrationen.
 *
 * **Regel: Migrationen werden nie geändert, nur angehängt.** Eine bereits
 * ausgelieferte Zeile in `MIGRATIONS` zu bearbeiten heißt, dass Rechner mit
 * alter Datei und Rechner mit Neuinstallation unterschiedliche Schemata haben.
 * Wer eine Spalte anders braucht, hängt eine neue Migration an.
 */
import { DatabaseSync } from "node:sqlite";
import { dirname } from "@std/path";
import { databasePath } from "./paths.ts";
import { log } from "./log.ts";

/** Index + 1 == `PRAGMA user_version` nach Anwendung. */
const MIGRATIONS: string[] = [
  // 1 — Ausgangsschema: Verlauf und Einstellungen
  `CREATE TABLE documents (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     path      TEXT    NOT NULL UNIQUE,
     name      TEXT    NOT NULL,
     dir       TEXT    NOT NULL,
     title     TEXT    NOT NULL,
     openedAt  TEXT    NOT NULL,
     openCount INTEGER NOT NULL DEFAULT 1,
     pinned    INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   -- Sortiert wird immer nach zuletzt geöffnet; ohne Index liest SQLite die
   -- ganze Tabelle, bevor LIMIT etwas abschneidet.
   CREATE INDEX idx_documents_opened ON documents(openedAt DESC);
   CREATE INDEX idx_documents_pinned ON documents(pinned, openedAt DESC);`,
];

export function migrate(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = Number(row.user_version);
  for (; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      // Achtung: PRAGMA nimmt keine Platzhalter — daher Template-String.
      // Der Wert stammt aus dem Schleifenzähler, nicht aus Eingaben.
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    log.info(`Migration ${version + 1} angewendet`);
  }
  return version;
}

/** Öffnet (und migriert) eine Datenbank. Tests übergeben `":memory:"`. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") Deno.mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) db = openDatabase(databasePath());
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

/**
 * Konsistente Sicherung im laufenden Betrieb — ein Einzeiler, den jede App
 * braucht. `VACUUM INTO` scheitert, wenn die Zieldatei existiert.
 */
export function backupTo(target: string): string {
  getDb().prepare("VACUUM INTO ?").run(target);
  log.info(`Sicherung geschrieben: ${target}`);
  return target;
}

export { databasePath };
