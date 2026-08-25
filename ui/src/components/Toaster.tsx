import { AlertTriangle, Check, Copy, Info, X } from "lucide-react";
import { useStore } from "@tanstack/react-store";
import { toast, ui, uiStore } from "../store/ui.ts";

const ICON = {
  info: <Info size={14} />,
  success: <Check size={14} />,
  error: <AlertTriangle size={14} />,
};

/**
 * Eine Stelle für alle Rückmeldungen. Fehler-Toasts verschwinden nicht von
 * selbst und bieten „Kopieren" an — ohne Konsole im ausgelieferten Fenster ist
 * das der einzige Weg, einen Fehlertext weiterzugeben.
 */
export function Toaster() {
  const toasts = useStore(uiStore, (state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((entry) => (
        <div key={entry.id} className={`toast ${entry.tone}`}>
          {ICON[entry.tone]}
          <div className="grow">
            <span>{entry.message}</span>
            {entry.detail && <pre className="toast-detail">{entry.detail}</pre>}
          </div>
          {entry.detail && (
            <button
              type="button"
              className="btn ghost icon"
              title="Fehlertext kopieren"
              onClick={() => {
                void navigator.clipboard.writeText(`${entry.message}\n${entry.detail}`);
                toast.success("In die Zwischenablage kopiert");
              }}
            >
              <Copy size={13} />
            </button>
          )}
          <button
            type="button"
            className="btn ghost icon"
            title="Schließen"
            onClick={() => ui.dismiss(entry.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
