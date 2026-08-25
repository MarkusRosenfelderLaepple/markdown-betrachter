/**
 * Alles, was das Fenster zur Anwendung macht: gemerkte Größe und Position,
 * natives Menü mit Tastenkürzeln, Brücke vom Menü in die Oberfläche.
 *
 * `Deno.BrowserWindow` ist in 2.9 nicht typisiert — deshalb die lokalen
 * Interfaces mit genau den Feldern, die hier benutzt werden. Sie sind die
 * Dokumentation der verwendeten API-Fläche.
 */
import { APP_NAME } from "./paths.ts";
import { readSetting, writeSetting } from "./settings.ts";
import { log } from "./log.ts";

// ── Minimal-Typisierung der Desktop-API ─────────────────────────────────────

type MenuItem =
  | { item: { label: string; id?: string; accelerator?: string; enabled: boolean } }
  | { submenu: { label: string; items: MenuItem[] } }
  | "separator"
  | { role: { role: string } };

export interface DesktopWindow {
  addEventListener?(type: string, listener: (event: CustomEvent<Record<string, number>>) => void): void;
  isClosed?(): boolean;
  close?(): void;
  focus?(): void;
  show?(): void;
  reload?(): void;
  openDevtools?(options?: { deno?: boolean; renderer?: boolean }): void;
  getSize?(): [number, number];
  getPosition?(): [number, number];
  setPosition?(x: number, y: number): void;
  setSize?(width: number, height: number): void;
  executeJs?(code: string): Promise<unknown>;
  setApplicationMenu?(items: MenuItem[]): void;
}

interface DesktopApi {
  BrowserWindow: new (options: Record<string, unknown>) => DesktopWindow;
}

export const hasBrowserWindow = "BrowserWindow" in Deno;

// ── Menü ────────────────────────────────────────────────────────────────────

/**
 * Die IDs sind der Vertrag zwischen nativem Menü und Oberfläche. Sie stehen
 * hier und in `ui/src/menu.ts` — beim Ergänzen also beide Seiten anfassen.
 *
 * `role`-Einträge (Kopieren, Einfügen, Beenden …) brauchen keine ID: Die
 * erledigt das Betriebssystem selbst, inklusive der üblichen Tastenkürzel.
 * Wer sie selbst nachbaut, bekommt genau die Fälle nicht, an die man nicht
 * denkt — etwa Kopieren aus einem Eingabefeld im Webview.
 */
const MENU: MenuItem[] = [
  {
    submenu: {
      label: APP_NAME,
      items: [
        { item: { label: `Über ${APP_NAME}`, id: "about", enabled: true } },
        "separator",
        { item: { label: "Einstellungen …", id: "settings", accelerator: "CmdOrCtrl+,", enabled: true } },
        "separator",
        { role: { role: "quit" } },
      ],
    },
  },
  {
    submenu: {
      label: "Datei",
      items: [
        { item: { label: "Öffnen …", id: "open", accelerator: "CmdOrCtrl+O", enabled: true } },
        { item: { label: "Neu laden", id: "refresh", accelerator: "CmdOrCtrl+R", enabled: true } },
        "separator",
        { item: { label: "Im Finder zeigen", id: "reveal", accelerator: "CmdOrCtrl+Alt+R", enabled: true } },
        { item: { label: "Pfad kopieren", id: "copy-path", enabled: true } },
        "separator",
        {
          item: {
            label: "Drucken / als PDF sichern …",
            id: "print",
            accelerator: "CmdOrCtrl+P",
            enabled: true,
          },
        },
      ],
    },
  },
  {
    submenu: {
      label: "Bearbeiten",
      items: [
        { role: { role: "undo" } },
        { role: { role: "redo" } },
        "separator",
        { role: { role: "cut" } },
        { role: { role: "copy" } },
        { role: { role: "paste" } },
        { role: { role: "selectAll" } },
        "separator",
        { item: { label: "Im Dokument suchen", id: "find", accelerator: "CmdOrCtrl+F", enabled: true } },
      ],
    },
  },
  {
    submenu: {
      label: "Ansicht",
      items: [
        {
          item: {
            label: "Verlauf ein-/ausblenden",
            id: "toggle-history",
            accelerator: "CmdOrCtrl+1",
            enabled: true,
          },
        },
        {
          item: {
            label: "Inhaltsverzeichnis ein-/ausblenden",
            id: "toggle-toc",
            accelerator: "CmdOrCtrl+2",
            enabled: true,
          },
        },
        "separator",
        { item: { label: "Größer", id: "zoom-in", accelerator: "CmdOrCtrl+Plus", enabled: true } },
        { item: { label: "Kleiner", id: "zoom-out", accelerator: "CmdOrCtrl+-", enabled: true } },
        { item: { label: "Normale Größe", id: "zoom-reset", accelerator: "CmdOrCtrl+0", enabled: true } },
        "separator",
        {
          item: {
            label: "Hell / Dunkel",
            id: "toggle-theme",
            accelerator: "CmdOrCtrl+Shift+L",
            enabled: true,
          },
        },
        "separator",
        { item: { label: "Zurück", id: "back", accelerator: "CmdOrCtrl+Left", enabled: true } },
        { item: { label: "Vorwärts", id: "forward", accelerator: "CmdOrCtrl+Right", enabled: true } },
        "separator",
        { item: { label: "Fenster neu laden", id: "reload", enabled: true } },
        {
          item: {
            label: "Entwicklerwerkzeuge",
            id: "devtools",
            accelerator: "CmdOrCtrl+Alt+I",
            enabled: true,
          },
        },
      ],
    },
  },
  {
    submenu: {
      label: "Hilfe",
      items: [
        { item: { label: "Tastenkürzel", id: "shortcuts", enabled: true } },
        { item: { label: "Protokoll anzeigen", id: "log", enabled: true } },
        { item: { label: `Über ${APP_NAME}`, id: "about", enabled: true } },
      ],
    },
  },
];

// ── Fenstergröße und -position ──────────────────────────────────────────────

const DEFAULT_BOUNDS = { width: 1100, height: 760 };
const MIN_SIZE = { width: 720, height: 480 };

/**
 * Gemerkte Maße nur übernehmen, wenn sie plausibel sind. Der praktische Fall
 * dahinter: Die App lief auf einem zweiten Bildschirm, der jetzt weg ist —
 * ohne Prüfung startet das Fenster außerhalb des sichtbaren Bereichs und die
 * App gilt als „geht nicht mehr auf".
 */
function restoredBounds(): Record<string, number> {
  const saved = readSetting("windowBounds");
  if (!saved) return DEFAULT_BOUNDS;
  const width = Math.max(saved.width, MIN_SIZE.width);
  const height = Math.max(saved.height, MIN_SIZE.height);
  const plausible = saved.x > -width + 100 && saved.y > -50 && saved.x < 20_000 && saved.y < 20_000;
  return plausible ? { width, height, x: saved.x, y: saved.y } : { width, height };
}

/**
 * Nachträgliche Prüfung gegen den tatsächlichen Bildschirm. Die Größe kennt
 * nur das Webview (`screen.availWidth`), deshalb geht die Frage dorthin,
 * sobald die Seite steht.
 *
 * Geprüft wird beides: Ein Fenster, das *breiter* als der Bildschirm ist, hängt
 * rechts hinaus — dort liegen Öffnen-Knopf, Themenschalter und das
 * Inhaltsverzeichnis, und die sind dann schlicht unerreichbar. Das passiert
 * ohne Zutun, sobald die App einmal an einem größeren Monitor lief.
 */
async function ensureOnScreen(win: DesktopWindow): Promise<void> {
  try {
    const raw = await win.executeJs?.("[screen.availWidth, screen.availHeight]");
    const [availWidth, availHeight] = raw as [number, number];
    let [x, y] = win.getPosition?.() ?? [0, 0];
    let [width, height] = win.getSize?.() ?? [DEFAULT_BOUNDS.width, DEFAULT_BOUNDS.height];

    if (width > availWidth || height > availHeight) {
      log.warn(`Fenster größer als der Bildschirm (${width}×${height}) — wird eingepasst`);
      width = Math.max(MIN_SIZE.width, Math.min(width, availWidth - 40));
      height = Math.max(MIN_SIZE.height, Math.min(height, availHeight - 40));
      win.setSize?.(width, height);
    }

    if (x > availWidth - 120 || y > availHeight - 80 || x + width < 120 || x + width > availWidth) {
      log.warn("Gemerkte Fensterposition liegt außerhalb des Bildschirms — Fenster wird zentriert");
      x = Math.max(0, Math.round((availWidth - width) / 2));
      y = Math.max(0, Math.min(y, availHeight - height - 20));
      win.setPosition?.(x, y);
    }
  } catch (error) {
    log.debug(`Bildschirmprüfung übersprungen: ${error}`);
  }
}

// ── Aufbau ──────────────────────────────────────────────────────────────────

export interface WindowHandle {
  win: DesktopWindow;
  /** Holt das Fenster nach vorn — vom Zweitstart über `/instance/focus` benutzt. */
  focus(): void;
}

export function createWindow(): WindowHandle | null {
  if (!hasBrowserWindow) return null;
  const { BrowserWindow } = Deno as unknown as DesktopApi;
  const win = new BrowserWindow({
    title: APP_NAME,
    transparentTitlebar: true,
    ...restoredBounds(),
  });

  win.setApplicationMenu?.(MENU);
  void ensureOnScreen(win);

  // Größe/Position gedrosselt speichern: `resize` feuert beim Ziehen im
  // Millisekundentakt — ungedrosselt schreibt man dabei hunderte Male in die
  // SQLite-Datei.
  // `ReturnType<typeof setTimeout>`, weil die DOM-Lib hier mit der Deno-Lib
  // zusammenliegt und `setTimeout` deshalb `Timeout` statt `number` liefert.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remember = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const [width, height] = win.getSize?.() ?? [0, 0];
        const [x, y] = win.getPosition?.() ?? [0, 0];
        if (width > 0 && height > 0) {
          writeSetting("windowBounds", {
            width: Math.round(width),
            height: Math.round(height),
            x: Math.round(x),
            y: Math.round(y),
          });
        }
      } catch (error) {
        log.debug(`Fensterzustand nicht gespeichert: ${error}`);
      }
    }, 500);
  };
  win.addEventListener?.("resize", remember);
  win.addEventListener?.("move", remember);

  win.addEventListener?.("menuclick", (event) => {
    const id = String((event.detail as unknown as { id?: string })?.id ?? "");
    if (!id) return;
    if (id === "reload") return win.reload?.();
    if (id === "devtools") return win.openDevtools?.();
    // Alles Übrige entscheidet die Oberfläche: Sie kennt Route, Auswahl und
    // offene Dialoge. Ein CustomEvent ist die kleinste Brücke dorthin —
    // `ui/src/menu.ts` hört darauf.
    void win.executeJs?.(
      `globalThis.dispatchEvent(new CustomEvent("appmenu", { detail: ${JSON.stringify({ id })} }))`,
    ).catch(() => {});
  });

  return {
    win,
    focus() {
      win.show?.();
      win.focus?.();
      // Das DOM-Ereignis `focus` feuert beim programmatischen Hervorholen nicht
      // zuverlässig — nachgemessen beim „Öffnen mit" in eine laufende App: das
      // Fenster kam nach vorn, die Datei blieb liegen. Deshalb dieselbe Brücke
      // wie beim Menü: ein CustomEvent, auf das `ui/src/App.tsx` hört.
      void win.executeJs?.(`globalThis.dispatchEvent(new CustomEvent("appopen"))`).catch(() => {});
    },
  };
}
