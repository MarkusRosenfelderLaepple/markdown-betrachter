/**
 * Der Rahmen: Kopfzeile, drei Spalten, Tastatur, natives Menü, Dialoge.
 *
 * Die Aufteilung ist die ganze App: **Verlauf** links, **Dokument** in der
 * Mitte, **Inhaltsverzeichnis** rechts. Beide Seitenleisten lassen sich
 * ausblenden und merken sich das (Einstellungen, also über den Start hinaus).
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  FolderTree,
  List,
  Loader2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  RefreshCw,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { client, errorMessage, tokenUrl, unwrap } from "./api.ts";
import { infoQuery, settingsQuery } from "./query.ts";
import { onMenuAction } from "./menu.ts";
import { applyTheme, isDark, toast, ui, uiStore } from "./store/ui.ts";
import { viewer, viewerStore } from "./store/viewer.ts";
import { workspace } from "./store/workspace.ts";
import type { Heading } from "./markdown.ts";
import { fmt } from "./format.ts";
import { AppErrorBoundary } from "./components/ErrorBoundary.tsx";
import { Toaster } from "./components/Toaster.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Toc } from "./components/Toc.tsx";
import { FindBar } from "./components/FindBar.tsx";
import { EmptyViewer, Viewer } from "./components/Viewer.tsx";
import { AboutDialog, SettingsDialog, ShortcutsDialog } from "./components/Dialogs.tsx";

type OpenDialog = "settings" | "shortcuts" | "about" | null;

export function App() {
  const settings = useStore(uiStore, (state) => state.settings);
  const { doc, loading, error, back, forward } = useStore(viewerStore, (state) => state);
  const info = useQuery(infoQuery);
  const serverSettings = useQuery(settingsQuery);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  // ── Einstellungen und Theme ───────────────────────────────────────────────

  useEffect(() => {
    if (serverSettings.data) ui.hydrate(serverSettings.data);
  }, [serverSettings.data]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    // Bei „System" der Systemeinstellung folgen, solange das Fenster offen ist.
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme("system");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  // Schriftgröße als CSS-Variable — eine Zahl, an der die ganze Typografie
  // hängt, statt Dutzender `font-size`-Werte in den Komponenten.
  useEffect(() => {
    document.documentElement.style.setProperty("--doc-scale", String(settings.fontScale));
  }, [settings.fontScale]);

  // ── Datei beim Start („Öffnen mit …") ─────────────────────────────────────

  /**
   * Der Startpfad wird beim Abholen serverseitig gelöscht. Sonst springt die
   * Ansicht bei jedem erneuten Laden von `/api/info` zurück auf die Datei, mit
   * der die App einmal gestartet wurde.
   */
  const claimStartup = useCallback(async () => {
    const { path, kind } = await unwrap<{ path: string | null; kind: "file" | "dir" | null }>(
      client.api.startup.claim.$post(),
    );
    if (!path) return;
    // Ein Ordner als Startargument meint den Arbeitsordner, keine Datei — wer
    // die App auf ein Projektverzeichnis zieht, will den Baum sehen.
    if (kind === "dir") return workspace.set(path);
    await viewer.open(path);
  }, []);

  useEffect(() => {
    void claimStartup().catch(() => {});
  }, [claimStartup]);

  /**
   * Ein Zweitstart mit Datei („Öffnen mit …", während die App läuft) holt das
   * Fenster nach vorn und legt den Pfad ab — das Fokussieren ist das Signal,
   * ihn abzuholen.
   */
  useEffect(() => {
    const onFocus = () => void claimStartup().catch(() => {});
    // Zwei Wege, weil keiner allein trägt: `focus` greift, wenn der Benutzer
    // das Fenster selbst anklickt; `appopen` schickt die Deno-Seite, wenn sie
    // das Fenster programmatisch hervorholt (dann bleibt `focus` stumm).
    globalThis.addEventListener("focus", onFocus);
    globalThis.addEventListener("appopen", onFocus);
    return () => {
      globalThis.removeEventListener("focus", onFocus);
      globalThis.removeEventListener("appopen", onFocus);
    };
  }, [claimStartup]);

  // ── Datei überwachen ──────────────────────────────────────────────────────

  /**
   * Server-Sent Events statt Abfragen im Sekundentakt: Der Server hört über
   * `Deno.watchFs` auf den Ordner und meldet sich, wenn es etwas zu melden
   * gibt. Ein Wechsel des Dokuments schließt die alte Verbindung — sonst
   * sammeln sich beim Blättern durch den Verlauf offene Ströme an.
   */
  useEffect(() => {
    if (!doc || !settings.autoReload) return;
    const source = new EventSource(tokenUrl("/api/watch", { path: doc.path }));
    source.addEventListener("change", () => {
      void viewer.refresh();
    });
    // Ein Fehler hier ist kein Fall für einen Toast: Die häufigste Ursache ist
    // das Schließen beim Dokumentwechsel, und der Betrachter funktioniert ohne
    // Überwachung vollständig weiter.
    source.onerror = () => source.close();
    return () => source.close();
  }, [doc?.path, settings.autoReload]);

  // ── Aktionen ──────────────────────────────────────────────────────────────

  const reveal = useCallback(() => {
    if (!doc) return;
    void unwrap(client.api.reveal.$post({ json: { path: doc.path } }))
      .catch((requestError) => toast.error(errorMessage(requestError)));
  }, [doc?.path]);

  const copyPath = useCallback(() => {
    if (!doc) return;
    void navigator.clipboard.writeText(doc.path)
      .then(() => toast.success("Pfad kopiert"))
      .catch(() => toast.error("Zwischenablage nicht verfügbar"));
  }, [doc?.path]);

  const zoom = useCallback((direction: -1 | 0 | 1) => {
    const current = uiStore.state.settings.fontScale;
    const next = direction === 0
      ? 1
      : Math.min(1.6, Math.max(0.8, Number((current + direction * 0.1).toFixed(2))));
    ui.set("fontScale", next);
  }, []);

  /**
   * Aktionen aus dem nativen Menü. Sie stehen hier, weil hier alles bekannt
   * ist, was sie brauchen — `menu.ts` ist bewusst nur die Brücke und kennt
   * weder Dokument noch Dialoge.
   */
  useEffect(() =>
    onMenuAction((action) => {
      switch (action) {
        case "open":
          return void viewer.pick();
        case "open-folder":
          return void workspace.pick();
        case "refresh":
          return void viewer.refresh();
        case "reveal":
          return reveal();
        case "copy-path":
          return copyPath();
        case "print":
          return globalThis.print();
        case "find":
          return viewer.openFind(true);
        case "toggle-history":
          return ui.toggle("showHistory");
        case "toggle-toc":
          return ui.toggle("showToc");
        case "toggle-sidebar-mode":
          return ui.set("sidebar", uiStore.state.settings.sidebar === "tree" ? "history" : "tree");
        case "toggle-theme":
          return ui.set("theme", isDark() ? "light" : "dark");
        case "zoom-in":
          return zoom(1);
        case "zoom-out":
          return zoom(-1);
        case "zoom-reset":
          return zoom(0);
        case "back":
          return void viewer.back();
        case "forward":
          return void viewer.forward();
        case "settings":
          return setDialog("settings");
        case "shortcuts":
          return setDialog("shortcuts");
        case "log":
        case "about":
          return setDialog("about");
      }
    }), [reveal, copyPath, zoom]);

  /**
   * Dieselben Kürzel auch ohne natives Menü — im Browser-Entwicklungslauf gibt
   * es keines, und dort wird der größte Teil der Arbeit gemacht.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      const actions: Record<string, () => void> = {
        o: () => (event.shiftKey ? void workspace.pick() : void viewer.pick()),
        r: () => void viewer.refresh(),
        f: () => viewer.openFind(true),
        "1": () => ui.toggle("showHistory"),
        "2": () => ui.toggle("showToc"),
        "3": () => ui.set("sidebar", uiStore.state.settings.sidebar === "tree" ? "history" : "tree"),
        "0": () => zoom(0),
        "+": () => zoom(1),
        "-": () => zoom(-1),
        arrowleft: () => void viewer.back(),
        arrowright: () => void viewer.forward(),
      };
      const action = actions[key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [zoom]);

  const canPick = info.data?.canPickFiles ?? false;

  return (
    <div className={`shell reading-${settings.reading}`}>
      {
        /* `-webkit-app-region: drag` steckt an `.topbar` — bei transparenter
          Titelleiste ist das der Griff, an dem das Fenster hängt. */
      }
      <header className="topbar">
        <div className="topbar-nav">
          <button
            type="button"
            className="btn ghost icon"
            title="Seitenleiste ein-/ausblenden (⌘1)"
            onClick={() => ui.toggle("showHistory")}
          >
            {settings.showHistory ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title="Zurück (⌘←)"
            disabled={back.length === 0}
            onClick={() => void viewer.back()}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title="Vorwärts (⌘→)"
            disabled={forward.length === 0}
            onClick={() => void viewer.forward()}
          >
            <ArrowRight size={16} />
          </button>
        </div>

        <div className="topbar-title grow">
          <h1 title={doc?.title}>{doc ? doc.title : "Markdown-Betrachter"}</h1>
          {doc && (
            <button
              type="button"
              className="topbar-path tiny muted"
              title={`${doc.path}\nKlicken: im Finder zeigen`}
              onClick={reveal}
            >
              {fmt.shortPath(doc.path, 4)}
            </button>
          )}
        </div>

        <div className="topbar-actions">
          {loading && <Loader2 size={15} className="spin muted" />}
          {doc && (
            <>
              <span className="badge tiny" title={`Zuletzt geändert: ${fmt.dateTime(doc.modifiedAt)}`}>
                {fmt.bytes(doc.size)}
              </span>
              {doc.encoding !== "utf-8" && (
                <span className="badge warn tiny" title={doc.encodingReason}>
                  {doc.encoding}
                </span>
              )}
              <button
                type="button"
                className="btn ghost icon"
                title="Neu laden (⌘R)"
                onClick={() => void viewer.refresh()}
              >
                <RefreshCw size={15} />
              </button>
              <button
                type="button"
                className="btn ghost icon"
                title="Drucken / als PDF sichern (⌘P)"
                onClick={() => globalThis.print()}
              >
                <Printer size={15} />
              </button>
            </>
          )}
          {canPick && (
            <>
              <button
                type="button"
                className="btn ghost icon"
                title="Ordner öffnen (⌘⇧O)"
                onClick={() => void workspace.pick()}
              >
                <FolderTree size={15} />
              </button>
              <button
                type="button"
                className="btn"
                title="Datei öffnen (⌘O)"
                onClick={() => void viewer.pick()}
              >
                <FolderOpen size={15} /> <span className="hide-narrow">Öffnen</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="btn ghost icon"
            title="Hell / Dunkel (⌘⇧L)"
            onClick={() => ui.set("theme", isDark() ? "light" : "dark")}
          >
            {isDark() ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title="Inhaltsverzeichnis ein-/ausblenden (⌘2)"
            onClick={() => ui.toggle("showToc")}
          >
            <List size={15} />
          </button>
        </div>
      </header>

      <div className="body">
        {settings.showHistory && <Sidebar canPick={canPick} />}

        <main className="doc-scroll">
          <FindBar />
          {
            /* Fangnetz um die Vorschau: Ein Renderfehler in einem fremden
              Dokument kostet die Ansicht, nicht das Fenster. */
          }
          <AppErrorBoundary>
            {error && !doc && (
              <div className="doc-empty">
                <TriangleAlert size={36} strokeWidth={1.2} className="warn-icon" />
                <h2>Nicht geöffnet</h2>
                <p className="muted">{error}</p>
              </div>
            )}
            {doc
              ? (
                <Viewer
                  key={doc.path}
                  doc={doc}
                  onHeadings={setHeadings}
                  onActiveHeading={setActive}
                />
              )
              : !error && <EmptyViewer canPick={canPick} />}
          </AppErrorBoundary>
        </main>

        {settings.showToc && doc && <Toc headings={headings} active={active} />}
      </div>

      <Toaster />

      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "about" && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
