/**
 * Verlauf: die erste der beiden Ansichten der linken Seitenleiste (die zweite
 * ist der Ordnerbaum, siehe `Tree.tsx`; den Rahmen stellt `Sidebar.tsx`).
 *
 * Er ist in einem Betrachter das Hauptnavigationsmittel für alles, was nicht
 * in einem Arbeitsordner liegt — einmal über den Dialog geöffnet, danach aus
 * dieser Liste. Angeheftetes steht oben und überlebt „Verlauf leeren".
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, FolderOpen, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import type { HistoryEntry } from "../../../shared/schema.ts";
import { client, errorMessage, unwrap } from "../api.ts";
import { historyQuery, invalidateHistory } from "../query.ts";
import { fmt } from "../format.ts";
import { toast } from "../store/ui.ts";
import { viewer, viewerStore } from "../store/viewer.ts";
import { useStore } from "@tanstack/react-store";
import { ConfirmDialog } from "./atoms.tsx";

export function History({ canPick }: { canPick: boolean }) {
  const [term, setTerm] = useState("");
  const openPath = useStore(viewerStore, (state) => state.doc?.path ?? null);
  const history = useQuery(historyQuery(term));
  const [confirmClear, setConfirmClear] = useState(false);

  const pin = useMutation({
    mutationFn: (entry: HistoryEntry) =>
      unwrap(client.api.documents[":id"].pin.$post({
        param: { id: String(entry.id) },
        json: { pinned: !entry.pinned },
      })),
    onSuccess: invalidateHistory,
  });

  const forget = useMutation({
    mutationFn: (entry: HistoryEntry) =>
      unwrap(client.api.documents[":id"].$delete({ param: { id: String(entry.id) } })),
    onSuccess: (_result, entry) => {
      if (entry.path === openPath) viewer.close();
      invalidateHistory();
    },
  });

  const clear = useMutation({
    mutationFn: () => unwrap<{ removed: number }>(client.api.documents.$delete()),
    onSuccess: (result) => {
      toast.success(`${fmt.int(result.removed)} Einträge entfernt`);
      invalidateHistory();
    },
  });

  const entries = history.data ?? [];
  const pinned = entries.filter((entry) => entry.pinned);
  const recent = entries.filter((entry) => !entry.pinned);

  return (
    <div className="side-body">
      <div className="side-head">
        <Clock size={15} />
        <strong>Verlauf</strong>
        {canPick && (
          <button
            type="button"
            className="btn ghost icon"
            style={{ marginLeft: "auto" }}
            title="Datei öffnen (⌘O)"
            onClick={() => void viewer.pick()}
          >
            <FolderOpen size={15} />
          </button>
        )}
      </div>

      <div className="side-search">
        <Search size={14} className="muted" />
        <input
          className="input"
          placeholder="Suchen …"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          aria-label="Verlauf durchsuchen"
        />
        {term && (
          <button
            type="button"
            className="btn ghost icon"
            title="Suche leeren"
            onClick={() => setTerm("")}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="side-list">
        {entries.length === 0 && (
          <p className="tiny muted side-empty">
            {term ? "Nichts gefunden." : "Noch nichts geöffnet."}
          </p>
        )}

        {pinned.length > 0 && <div className="side-label">Angeheftet</div>}
        {pinned.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            active={entry.path === openPath}
            onPin={() => pin.mutate(entry)}
            onForget={() => forget.mutate(entry)}
          />
        ))}

        {pinned.length > 0 && recent.length > 0 && <div className="side-label">Zuletzt</div>}
        {recent.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            active={entry.path === openPath}
            onPin={() => pin.mutate(entry)}
            onForget={() => forget.mutate(entry)}
          />
        ))}
      </div>

      {recent.length > 0 && (
        <div className="side-foot">
          <button
            type="button"
            className="btn ghost tiny-btn"
            onClick={() => setConfirmClear(true)}
            title="Angeheftetes bleibt stehen"
          >
            <Trash2 size={13} /> Verlauf leeren
          </button>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Verlauf leeren"
          message="Alle nicht angehefteten Einträge werden entfernt. Die Dateien selbst bleiben unberührt."
          confirmLabel="Leeren"
          onConfirm={() => {
            clear.mutate();
            setConfirmClear(false);
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

function Entry(
  { entry, active, onPin, onForget }: {
    entry: HistoryEntry;
    active: boolean;
    onPin: () => void;
    onForget: () => void;
  },
) {
  return (
    <div className={`side-item ${active ? "active" : ""} ${entry.exists ? "" : "missing"}`}>
      <button
        type="button"
        className="side-item-main"
        title={entry.exists ? entry.path : `${entry.path}\n(Datei nicht gefunden)`}
        onClick={() => {
          if (!entry.exists) {
            toast.error("Datei nicht gefunden", entry.path);
            return;
          }
          void viewer.open(entry.path).catch((error) => toast.error(errorMessage(error)));
        }}
      >
        <span className="side-item-title">{entry.title}</span>
        <span className="side-item-sub tiny muted">
          {fmt.shortPath(entry.dir, 2)} · {fmt.relative(entry.openedAt)}
        </span>
      </button>
      <div className="side-item-actions">
        <button
          type="button"
          className="btn ghost icon"
          title={entry.pinned ? "Lösen" : "Anheften"}
          onClick={onPin}
        >
          {entry.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button type="button" className="btn ghost icon" title="Aus dem Verlauf entfernen" onClick={onForget}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
