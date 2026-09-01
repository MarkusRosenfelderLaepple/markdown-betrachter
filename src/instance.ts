/**
 * Einzelinstanz-Sperre.
 *
 * Zwei Instanzen auf derselben SQLite-Datei sind ein Datenrennen — WAL
 * verhindert Verluste beim einzelnen Schreibvorgang, nicht aber zwei Fenster,
 * die sich gegenseitig Zustand überschreiben. Der zweite Start soll deshalb
 * nicht laufen, sondern das **vorhandene Fenster nach vorn holen**.
 *
 * Umsetzung: eine Lockdatei mit PID, Port und einem Geheimnis. Der zweite
 * Start liest sie, ruft beim laufenden Server an und beendet sich. Antwortet
 * niemand, war die Datei verwaist (Absturz, Neustart) und wird überschrieben —
 * eine PID-Prüfung ist dafür nicht nötig und plattformübergreifend heikler.
 *
 * Das Geheimnis in der Datei ist der Grund, warum die Route außerhalb der
 * Token-Middleware liegen darf: Nur wer die Datei lesen kann (also das
 * Benutzerkonto), kann das Fenster fremdsteuern — eine Webseite im Browser
 * kann es nicht.
 */
import { join } from "@std/path";
import type { StartupTarget } from "./startup.ts";
import { dataDir } from "./paths.ts";
import { log } from "./log.ts";

export const FOCUS_PATH = "/instance/focus";
export const FOCUS_HEADER = "x-instance-secret";

interface LockFile {
  pid: number;
  port: number;
  secret: string;
  startedAt: string;
}

export const INSTANCE_SECRET = crypto.randomUUID();

function lockPath(): string {
  return join(dataDir(), "instance.lock");
}

function readLock(): LockFile | null {
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(lockPath())) as Partial<LockFile>;
    if (typeof parsed.port !== "number" || typeof parsed.secret !== "string") return null;
    return parsed as LockFile;
  } catch {
    return null;
  }
}

/**
 * Gibt `true` zurück, wenn bereits eine Instanz läuft und deren Fenster
 * geweckt wurde — der Aufrufer beendet sich dann sofort.
 */
export async function focusRunningInstance(target?: StartupTarget | null): Promise<boolean> {
  const lock = readLock();
  if (!lock) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${lock.port}${FOCUS_PATH}`, {
      method: "POST",
      // Der Zweitstart reicht mit, womit er aufgerufen wurde („Öffnen mit …",
      // während die App schon läuft) — die laufende Instanz zeigt die Datei an
      // bzw. übernimmt den Ordner, statt dass ein zweites Fenster aufginge.
      headers: { [FOCUS_HEADER]: lock.secret, "content-type": "application/json" },
      body: JSON.stringify({ path: target?.path ?? null, kind: target?.kind ?? null }),
      signal: AbortSignal.timeout(1500),
    });
    // Body immer abholen, sonst bleibt die Verbindung offen und der Prozess
    // beendet sich nicht.
    await response.body?.cancel();
    if (response.ok) {
      log.info(`Bereits laufende Instanz (PID ${lock.pid}) in den Vordergrund geholt`);
      return true;
    }
  } catch {
    log.info("Verwaiste Lockdatei gefunden — sie wird überschrieben");
  }
  return false;
}

export function writeLock(port: number): void {
  const lock: LockFile = {
    pid: Deno.pid,
    port,
    secret: INSTANCE_SECRET,
    startedAt: new Date().toISOString(),
  };
  Deno.mkdirSync(dataDir(), { recursive: true });
  Deno.writeTextFileSync(lockPath(), JSON.stringify(lock));
}

export function releaseLock(): void {
  const lock = readLock();
  // Nur die eigene Sperre entfernen — sonst räumt ein abstürzender Zweitstart
  // die Datei der laufenden Instanz weg.
  if (lock?.pid !== Deno.pid) return;
  try {
    Deno.removeSync(lockPath());
  } catch { /* schon weg */ }
}
