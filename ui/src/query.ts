/**
 * Serverzustand: eine Query-Option pro Ressource, an einer Stelle definiert.
 *
 * Was hier steht, gehört dem Server (Verlauf, Einstellungen, Dokumentinhalt).
 * Was die Oberfläche über sich selbst weiß — welches Dokument gerade offen
 * ist, wo man herkam, ob die Seitenleiste offen ist — steht in
 * `store/viewer.ts`.
 */
import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { AppInfo, Doc, HistoryEntry, Settings } from "../../shared/schema.ts";
import { client, errorMessage, unwrap } from "./api.ts";
import { toast } from "./store/ui.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      // Desktop-App: Das Fenster ist oft lange im Hintergrund, und der Verlauf
      // kann sich in der Zwischenzeit geändert haben (zweites Fenster, Datei
      // verschoben). Ein Neuladen beim Fokussieren ist hier erwünscht.
      refetchOnWindowFocus: true,
    },
    mutations: {
      onError: (error) => toast.error(errorMessage(error)),
    },
  },
});

/**
 * Der Verlauf. Der Suchtext steckt im Schlüssel — gefiltert wird in SQL, nicht
 * in der Seitenleiste: Sonst durchsucht die Suche nur, was gerade geladen ist.
 */
export const historyQuery = (q: string) =>
  queryOptions({
    queryKey: ["documents", q] as const,
    queryFn: () => unwrap<HistoryEntry[]>(client.api.documents.$get({ query: { q, limit: "200" } })),
  });

export const settingsQuery = queryOptions({
  queryKey: ["settings"] as const,
  queryFn: () => unwrap<Settings>(client.api.settings.$get()),
  staleTime: Infinity,
});

export const infoQuery = queryOptions({
  queryKey: ["info"] as const,
  queryFn: () => unwrap<AppInfo>(client.api.info.$get()),
  staleTime: Infinity,
});

export const logQuery = queryOptions({
  queryKey: ["log"] as const,
  queryFn: () => unwrap<{ path: string; lines: string[] }>(client.api.log.$get()),
  staleTime: 0,
});

/** Öffnet über den nativen Dialog; `doc` ist `null`, wenn abgebrochen wurde. */
export function pickDocument(): Promise<{ doc: Doc | null }> {
  return unwrap<{ doc: Doc | null }>(client.api.documents.pick.$post());
}

/** Öffnet einen bekannten Pfad (Verlauf, Link im Dokument, Startargument). */
export function openDocument(path: string, remember = true): Promise<{ doc: Doc | null }> {
  return unwrap<{ doc: Doc | null }>(client.api.documents.open.$post({ json: { path, remember } }));
}

export function invalidateHistory(): void {
  void queryClient.invalidateQueries({ queryKey: ["documents"] });
}
