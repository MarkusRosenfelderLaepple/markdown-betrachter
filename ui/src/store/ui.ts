/**
 * Globaler UI-Zustand: Einstellungen (Spiegel der Serverwerte) und Toasts.
 *
 * Bewusst *nicht* Serverzustand im Sinne von React Query — der liegt in
 * `query.ts`. Die Einstellungen stehen trotzdem hier: Sie werden bei jedem
 * Tastendruck (Schriftgröße, Leseweite) gelesen, und ein `useQuery` in jeder
 * Komponente wäre für einen Wert, der praktisch nie veraltet, der falsche
 * Weg. Geschrieben wird optimistisch: erst hier, dann zum Server.
 */
import { Store } from "@tanstack/react-store";
import type { SettingKey, Settings, SettingValue } from "../../../shared/schema.ts";
import { client, errorMessage, unwrap } from "../api.ts";

export type Theme = Settings["theme"];
export type ToastTone = "info" | "success" | "error";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Bei Fehlern der kopierbare Zusatztext (Pfad, Stacktrace). */
  detail?: string;
}

/** Vorgaben identisch zu `SETTINGS` in `shared/schema.ts` — bis der Server antwortet. */
const DEFAULTS: Settings = {
  theme: "system",
  lastDir: "",
  reading: "normal",
  fontScale: 1,
  autoReload: true,
  showToc: true,
  showHistory: true,
  sidebar: "history",
  workspaceDir: "",
  windowBounds: null,
};

export interface UiState {
  settings: Settings;
  toasts: Toast[];
}

export const uiStore = new Store<UiState>({ settings: DEFAULTS, toasts: [] });

let nextId = 1;

export const ui = {
  /** Einmal beim Start: Serverwerte übernehmen, ohne sie zurückzuschreiben. */
  hydrate(settings: Partial<Settings>) {
    uiStore.setState((state) => ({ ...state, settings: { ...state.settings, ...settings } }));
  },

  /**
   * Ändern und speichern. Optimistisch, weil die Wirkung sofort sichtbar sein
   * muss (Theme, Schriftgröße) — schlägt das Speichern fehl, bleibt der Wert
   * für diese Sitzung stehen und der Fehler wird gemeldet.
   */
  set<K extends SettingKey>(key: K, value: SettingValue<K>) {
    uiStore.setState((state) => ({ ...state, settings: { ...state.settings, [key]: value } }));
    void unwrap(client.api.settings[":key"].$put({ param: { key }, json: { value } }))
      .catch((error) => toast.error(`Einstellung „${key}" nicht gespeichert`, errorMessage(error)));
  },

  toggle(key: "showToc" | "showHistory" | "autoReload") {
    ui.set(key, !uiStore.state.settings[key]);
  },

  dismiss(id: number) {
    uiStore.setState((state) => ({ ...state, toasts: state.toasts.filter((entry) => entry.id !== id) }));
  },
};

function push(tone: ToastTone, message: string, detail?: string): number {
  const id = nextId++;
  uiStore.setState((state) => ({ ...state, toasts: [...state.toasts, { id, tone, message, detail }] }));
  // Fehler bleiben stehen, bis sie weggeklickt werden — sie sind der Fall, den
  // man lesen und weitergeben können muss.
  if (tone !== "error") setTimeout(() => ui.dismiss(id), 3000);
  return id;
}

export const toast = {
  info: (message: string) => push("info", message),
  success: (message: string) => push("success", message),
  error: (message: string, detail?: string) => push("error", message, detail),
};

/**
 * `system` auf die tatsächliche Vorliebe auflösen.
 *
 * Diese Funktion ist der Grund, warum nirgends `dataset.theme` **gelesen**
 * wird: Effekte der Kinder laufen vor denen der Eltern. Ein Kind, das die
 * Farbe aus dem DOM liest, sieht bei einem Themenwechsel deshalb noch den
 * alten Wert — konkret erwischt: Mermaid zeichnete beim Umschalten auf Dunkel
 * ein helles Diagramm, und erst der übernächste Wechsel passte es an.
 */
export function resolveDark(theme: Theme): boolean {
  return theme === "dark" ||
    (theme === "system" && (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false));
}

/** Aufgelöstes Theme ans `<html>` schreiben — die CSS-Tokens hängen daran. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveDark(theme) ? "dark" : "light";
}

/** Für Knöpfe („Hell/Dunkel") — dort ist der gerade sichtbare Zustand gemeint. */
export function isDark(): boolean {
  return resolveDark(uiStore.state.settings.theme);
}
