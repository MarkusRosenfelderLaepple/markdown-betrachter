/**
 * Das offene Dokument und der Weg dorthin.
 *
 * Warum kein Router: Die App hat **eine** Ansicht. Was hier wie Navigation
 * aussieht, ist keine Navigation zwischen Seiten, sondern zwischen Dokumenten
 * — und die stehen als Pfade auf einem Stapel, nicht als URLs. Zurück (⌘←)
 * springt zum vorigen Dokument, so wie man es von einem Betrachter erwartet.
 */
import { Store } from "@tanstack/react-store";
import type { Doc } from "../../../shared/schema.ts";
import { errorMessage } from "../api.ts";
import { invalidateHistory, openDocument, pickDocument } from "../query.ts";
import { toast } from "./ui.ts";

export interface ViewerState {
  doc: Doc | null;
  loading: boolean;
  /** Fehler beim Öffnen — bleibt stehen, bis ein anderes Dokument geöffnet wird. */
  error: string | null;
  /** Pfade, zu denen „Zurück" führt (jüngster zuletzt). */
  back: string[];
  forward: string[];
  /** Suchleiste im Dokument (⌘F). */
  find: string;
  findOpen: boolean;
}

export const viewerStore = new Store<ViewerState>({
  doc: null,
  loading: false,
  error: null,
  back: [],
  forward: [],
  find: "",
  findOpen: false,
});

type Mode = "push" | "replace" | "back" | "forward";

async function load(path: string, mode: Mode, remember = true): Promise<void> {
  const previous = viewerStore.state.doc?.path ?? null;
  viewerStore.setState((state) => ({ ...state, loading: true, error: null }));
  try {
    const { doc } = await openDocument(path, remember);
    if (!doc) return;
    viewerStore.setState((state) => {
      const back = [...state.back];
      let forward = [...state.forward];
      if (mode === "push" && previous && previous !== doc.path) {
        back.push(previous);
        // Ein neuer Sprung verwirft den Vorwärtsweg — sonst führt „Vorwärts"
        // in einen Zweig, den man verlassen hat.
        forward = [];
      }
      if (mode === "back") {
        back.pop();
        if (previous) forward = [...forward, previous];
      }
      if (mode === "forward") {
        forward.pop();
        if (previous) back.push(previous);
      }
      return { ...state, doc, loading: false, error: null, back, forward };
    });
    if (remember) invalidateHistory();
  } catch (error) {
    const message = errorMessage(error);
    viewerStore.setState((state) => ({ ...state, loading: false, error: message }));
    toast.error(message, path);
  }
}

export const viewer = {
  /** Nativer Öffnen-Dialog (läuft auf der Deno-Seite, siehe `src/files.ts`). */
  async pick(): Promise<void> {
    viewerStore.setState((state) => ({ ...state, loading: true }));
    try {
      const { doc } = await pickDocument();
      if (!doc) return; // Abbruch im Dialog ist kein Fehler.
      const previous = viewerStore.state.doc?.path ?? null;
      viewerStore.setState((state) => ({
        ...state,
        doc,
        error: null,
        back: previous && previous !== doc.path ? [...state.back, previous] : state.back,
        forward: [],
      }));
      invalidateHistory();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      viewerStore.setState((state) => ({ ...state, loading: false }));
    }
  },

  open: (path: string) => load(path, "push"),

  /**
   * Neu einlesen, ohne den Verlauf zu berühren: Das automatische Neuladen nach
   * einer Dateiänderung ist kein „Öffnen" und darf den Eintrag nicht nach oben
   * sortieren.
   */
  refresh(): Promise<void> {
    const path = viewerStore.state.doc?.path;
    return path ? load(path, "replace", false) : Promise.resolve();
  },

  back(): Promise<void> {
    const path = viewerStore.state.back.at(-1);
    return path ? load(path, "back", false) : Promise.resolve();
  },

  forward(): Promise<void> {
    const path = viewerStore.state.forward.at(-1);
    return path ? load(path, "forward", false) : Promise.resolve();
  },

  /** Nach dem Löschen des offenen Dokuments aus dem Verlauf. */
  close(): void {
    viewerStore.setState((state) => ({ ...state, doc: null, error: null }));
  },

  setFind(find: string): void {
    viewerStore.setState((state) => ({ ...state, find }));
  },

  openFind(open: boolean): void {
    viewerStore.setState((state) => ({ ...state, findOpen: open, find: open ? state.find : "" }));
  },
};
