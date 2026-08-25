/**
 * Der Verlauf: eine Datei pro Ressource, typisierte Queries, **genau eine**
 * Stelle, die aus einer SQLite-Zeile einen Typ macht.
 *
 * Zeilen aus `node:sqlite` sind `[Object: null prototype]` und untypisiert —
 * `as HistoryEntry[]` wäre wieder nur eine Behauptung. `toEntry()` endet
 * deshalb mit `HistoryEntry.parse(...)`, und sonst castet niemand.
 */
import { HistoryEntry, type HistoryQuery } from "../../shared/schema.ts";
import { getDb } from "../db.ts";

interface Row {
  id: number;
  path: string;
  name: string;
  dir: string;
  title: string;
  openedAt: string;
  openCount: number;
  pinned: number;
}

/** Die einzige Stelle, an der aus einer Zeile ein Typ wird. */
function toEntry(row: Row, exists: boolean): HistoryEntry {
  return HistoryEntry.parse({
    id: Number(row.id),
    path: String(row.path),
    name: String(row.name),
    dir: String(row.dir),
    title: String(row.title),
    openedAt: String(row.openedAt),
    openCount: Number(row.openCount),
    // SQLite hat keinen BOOLEAN-Typ — beim Mappen konvertieren, nicht später.
    pinned: Number(row.pinned) === 1,
    exists,
  });
}

export interface UpsertInput {
  path: string;
  name: string;
  dir: string;
  title: string;
}

/**
 * Öffnen protokollieren. `ON CONFLICT` statt „erst suchen, dann schreiben":
 * Der Pfad ist eindeutig, und der Titel kann sich geändert haben (die erste
 * Überschrift der Datei wurde bearbeitet).
 */
export function remember(input: UpsertInput): number {
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO documents(path, name, dir, title, openedAt, openCount)
     VALUES(?, ?, ?, ?, ?, 1)
     ON CONFLICT(path) DO UPDATE SET
       name      = excluded.name,
       dir       = excluded.dir,
       title     = excluded.title,
       openedAt  = excluded.openedAt,
       openCount = documents.openCount + 1`,
  ).run(input.path, input.name, input.dir, input.title, now);
  return idOf(input.path) ?? 0;
}

/**
 * Titel nachziehen, ohne als „geöffnet" zu zählen — für das automatische
 * Neuladen einer überwachten Datei.
 */
export function touchTitle(path: string, title: string): void {
  getDb().prepare("UPDATE documents SET title = ? WHERE path = ?").run(title, path);
}

export function idOf(path: string): number | null {
  const row = getDb().prepare("SELECT id FROM documents WHERE path = ?").get(path) as
    | { id: number }
    | undefined;
  return row ? Number(row.id) : null;
}

export function byId(id: number): HistoryEntry | null {
  const row = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as Row | undefined;
  return row ? toEntry(row, existsSync(row.path)) : null;
}

/**
 * Verlauf: angeheftete zuerst, dann nach zuletzt geöffnet. Die Suche läuft in
 * SQL statt in der Oberfläche — sonst filtert die Seitenleiste nur das, was
 * gerade geladen ist.
 */
export function list(query: HistoryQuery): HistoryEntry[] {
  const term = query.q.trim();
  const where = term ? "WHERE title LIKE ?1 OR name LIKE ?1 OR path LIKE ?1" : "";
  const statement = getDb().prepare(
    `SELECT * FROM documents ${where} ORDER BY pinned DESC, openedAt DESC LIMIT ${query.limit}`,
  );
  const rows = (term ? statement.all(`%${term}%`) : statement.all()) as unknown as Row[];
  return rows.map((row) => toEntry(row, existsSync(row.path)));
}

export function setPinned(id: number, pinned: boolean): HistoryEntry | null {
  getDb().prepare("UPDATE documents SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  return byId(id);
}

export function remove(id: number): void {
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
}

/** „Verlauf leeren" lässt Angeheftetes stehen — sonst ist das Anheften wertlos. */
export function clearUnpinned(): number {
  const before = count();
  getDb().prepare("DELETE FROM documents WHERE pinned = 0").run();
  return before - count();
}

/** Einträge, deren Datei es nicht mehr gibt. */
export function removeMissing(): number {
  const rows = getDb().prepare("SELECT id, path FROM documents").all() as unknown as {
    id: number;
    path: string;
  }[];
  const gone = rows.filter((row) => !existsSync(row.path));
  for (const row of gone) remove(Number(row.id));
  return gone.length;
}

export function count(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number };
  return Number(row.n);
}

function existsSync(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}
