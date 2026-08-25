import { ErrorBoundary } from "react-error-boundary";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "../store/ui.ts";

/**
 * Ohne Fangnetz ist ein Renderfehler in einer Desktop-App ein **weißes
 * Fenster** — der Anwender hat keine Konsole zum Nachsehen und kein
 * „Neu laden" im Menü. Deshalb: Fehlertext anzeigen, kopierbar machen,
 * Neuversuch anbieten.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => {
        const text = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
        return (
          <section className="card" style={{ borderColor: "var(--red)" }}>
            <header className="card-head">
              <AlertTriangle size={15} />
              <h2>Diese Ansicht ist abgestürzt</h2>
            </header>
            <p className="tiny muted">
              Der Fehler ist im Protokoll (Einstellungen ▸ Protokoll anzeigen) nicht enthalten — er ist im
              Fenster passiert. Bitte den Text kopieren und weitergeben.
            </p>
            <pre className="log" style={{ maxHeight: 220 }}>{text}</pre>
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn primary" onClick={resetErrorBoundary}>
                <RefreshCw size={14} /> Neu laden
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(text);
                  toast.success("Fehlertext kopiert");
                }}
              >
                <Copy size={14} /> Kopieren
              </button>
            </div>
          </section>
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
