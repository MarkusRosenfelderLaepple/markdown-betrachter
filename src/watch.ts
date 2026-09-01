/**
 * Dateiüberwachung für „im Editor speichern → Vorschau ist aktuell".
 *
 * Der Stolperstein steckt gleich am Anfang: **Überwacht wird der Ordner, nicht
 * die Datei.** Die meisten Editoren speichern atomar — sie schreiben eine
 * temporäre Datei und benennen sie um. Der Beobachter auf dem alten Inode
 * sieht danach nie wieder etwas, und die Vorschau steht still, ohne dass ein
 * Fehler auftaucht.
 */
import { dirname, resolve } from "@std/path";
import { isTreeDocument } from "./tree.ts";
import { log } from "./log.ts";

type Listener = () => void;

interface DirWatch {
  watcher: Deno.FsWatcher;
  /** Pfad (absolut) → Zuhörer dieser Datei. */
  files: Map<string, Set<Listener>>;
}

const watches = new Map<string, DirWatch>();

/**
 * Kurz sammeln, statt jedes Ereignis durchzureichen: Ein einziges Speichern
 * erzeugt je nach Editor `create`, `modify` und `rename` hintereinander —
 * ungedrosselt lädt die Oberfläche dieselbe Datei dreimal.
 */
const DEBOUNCE_MS = 120;

export function watchFile(path: string, listener: Listener): () => void {
  const file = resolve(path);
  const dir = dirname(file);
  let watch = watches.get(dir);

  if (!watch) {
    const watcher = Deno.watchFs(dir, { recursive: false });
    watch = { watcher, files: new Map() };
    watches.set(dir, watch);
    void pump(dir, watch);
    log.debug(`Ordner wird überwacht: ${dir}`);
  }

  const listeners = watch.files.get(file) ?? new Set<Listener>();
  listeners.add(listener);
  watch.files.set(file, listeners);

  return () => {
    const current = watches.get(dir);
    if (!current) return;
    const set = current.files.get(file);
    set?.delete(listener);
    if (set && set.size === 0) current.files.delete(file);
    // Letzter Zuhörer weg: Beobachter schließen. Sonst hält jedes einmal
    // geöffnete Verzeichnis für die Laufzeit der App einen Dateideskriptor.
    if (current.files.size === 0) {
      watches.delete(dir);
      try {
        current.watcher.close();
      } catch { /* schon geschlossen */ }
      log.debug(`Überwachung beendet: ${dir}`);
    }
  };
}

// ── Arbeitsordner überwachen ────────────────────────────────────────────────

/**
 * Beim Ordnerbaum ist die Frage eine andere als bei der offenen Datei: nicht
 * „hat sich *diese* Datei geändert", sondern „stimmt die **Liste** noch".
 *
 * Deshalb ein zweiter, rekursiver Beobachter je Arbeitsordner — und eine
 * deutlich längere Wartezeit als beim Dokument. Ein `git checkout` oder ein
 * `npm install` im Arbeitsordner erzeugt tausende Ereignisse; jedes davon
 * einzeln zu melden hieße, den Baum tausendmal neu einzulesen.
 */
interface TreeWatch {
  watcher: Deno.FsWatcher;
  listeners: Set<Listener>;
}

const treeWatches = new Map<string, TreeWatch>();

const TREE_DEBOUNCE_MS = 400;

/**
 * Welche Ereignisse den Baum überhaupt betreffen.
 *
 * Ohne diesen Filter löst jedes Speichern einer `.ts`-Datei im Projekt ein
 * Neueinlesen aus — im Alltag also im Sekundentakt. Gemeldet wird deshalb nur:
 * ein Dokument, eine `.gitignore` (sie ändert, was sichtbar ist), oder ein
 * Pfad ohne Endung — das ist mutmaßlich ein Ordner, und bei einem gelöschten
 * lässt sich das nicht mehr nachsehen.
 */
function affectsTree(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  if (name === ".gitignore") return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return true;
  return isTreeDocument(name);
}

export function watchTree(root: string, listener: Listener): () => void {
  const dir = resolve(root);
  let watch = treeWatches.get(dir);

  if (!watch) {
    const watcher = Deno.watchFs(dir, { recursive: true });
    watch = { watcher, listeners: new Set() };
    treeWatches.set(dir, watch);
    void pumpTree(dir, watch);
    log.debug(`Arbeitsordner wird überwacht: ${dir}`);
  }

  watch.listeners.add(listener);

  return () => {
    const current = treeWatches.get(dir);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    treeWatches.delete(dir);
    try {
      current.watcher.close();
    } catch { /* schon geschlossen */ }
    log.debug(`Überwachung des Arbeitsordners beendet: ${dir}`);
  };
}

async function pumpTree(dir: string, watch: TreeWatch): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for await (const event of watch.watcher) {
      if (event.kind === "access") continue;
      // Ein geänderter *Inhalt* ändert den Baum nicht — `modify` zählt deshalb
      // nur für die `.gitignore`, weil die entscheidet, was überhaupt sichtbar
      // ist. Anlegen, Löschen und Umbenennen zählen immer.
      const relevant = event.paths.some((path) =>
        event.kind === "modify" ? path.endsWith(".gitignore") : affectsTree(path)
      );
      if (!relevant) continue;
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const listener of watch.listeners) {
          try {
            listener();
          } catch (error) {
            log.warn(`Zuhörer der Ordnerüberwachung warf: ${error}`);
          }
        }
      }, TREE_DEBOUNCE_MS);
    }
  } catch (error) {
    log.debug(`Überwachung von ${dir} beendet: ${error}`);
  } finally {
    clearTimeout(timer);
    treeWatches.delete(dir);
  }
}

async function pump(dir: string, watch: DirWatch): Promise<void> {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  try {
    for await (const event of watch.watcher) {
      if (event.kind === "access") continue;
      for (const raw of event.paths) {
        const path = resolve(raw);
        if (!watch.files.has(path)) continue;
        clearTimeout(pending.get(path));
        pending.set(
          path,
          setTimeout(() => {
            pending.delete(path);
            for (const listener of watch.files.get(path) ?? []) {
              try {
                listener();
              } catch (error) {
                log.warn(`Zuhörer der Überwachung warf: ${error}`);
              }
            }
          }, DEBOUNCE_MS),
        );
      }
    }
  } catch (error) {
    // Ordner gelöscht oder Beobachter geschlossen — kein Grund für einen Absturz.
    log.debug(`Überwachung von ${dir} beendet: ${error}`);
  } finally {
    for (const timer of pending.values()) clearTimeout(timer);
    watches.delete(dir);
  }
}
