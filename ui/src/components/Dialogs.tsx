/**
 * Die drei Dialoge der App: Einstellungen, Tastenkürzel, Über.
 *
 * Sie stehen zusammen in einer Datei, weil sie sich denselben Rahmen teilen
 * und keiner davon mehr als eine Bildschirmhöhe hat — drei Dateien mit je
 * einem `<Modal>` wären mehr Ablage als Ordnung.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { FileClock, Info, Keyboard, Save, Settings as SettingsIcon } from "lucide-react";
import { client, errorMessage, unwrap } from "../api.ts";
import { infoQuery, logQuery } from "../query.ts";
import { toast, ui, uiStore } from "../store/ui.ts";
import { fmt } from "../format.ts";
import { Modal, Segmented } from "./atoms.tsx";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore(uiStore, (state) => state.settings);
  const info = useQuery(infoQuery);

  const backup = useMutation({
    mutationFn: () => unwrap<{ path: string }>(client.api.backup.$post()),
    onSuccess: (result) => toast.success(`Sicherung geschrieben: ${result.path}`),
  });

  const showLog = useMutation({
    mutationFn: () => unwrap(client.api.log.reveal.$post()),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const prune = useMutation({
    mutationFn: () => unwrap<{ removed: number }>(client.api.documents.prune.$post()),
    onSuccess: (result) => toast.success(`${fmt.int(result.removed)} verwaiste Einträge entfernt`),
  });

  return (
    <Modal
      title="Einstellungen"
      icon={<SettingsIcon size={15} />}
      onClose={onClose}
      description="Darstellung, Verhalten und Daten dieser Installation."
    >
      <div className="field">
        <label htmlFor="theme-choice">Erscheinungsbild</label>
        <Segmented
          value={settings.theme}
          onChange={(value) => ui.set("theme", value)}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Hell" },
            { value: "dark", label: "Dunkel" },
          ]}
        />
      </div>

      <div className="field">
        <label htmlFor="reading-width">Lesebreite</label>
        <Segmented
          value={settings.reading}
          onChange={(value) => ui.set("reading", value)}
          options={[
            { value: "schmal", label: "Schmal" },
            { value: "normal", label: "Normal" },
            { value: "weit", label: "Weit" },
          ]}
        />
        <span className="tiny muted">
          „Weit" nutzt das ganze Fenster — sinnvoll bei breiten Tabellen und Diagrammen.
        </span>
      </div>

      <div className="field">
        <label htmlFor="font-scale">Schriftgröße: {Math.round(settings.fontScale * 100)} %</label>
        <input
          id="font-scale"
          type="range"
          min="0.8"
          max="1.6"
          step="0.05"
          value={settings.fontScale}
          onChange={(event) => ui.set("fontScale", Number(event.target.value))}
        />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.autoReload}
          onChange={(event) => ui.set("autoReload", event.target.checked)}
        />
        <span>
          Datei überwachen und bei Änderung neu laden
          <span className="tiny muted block">
            Speichern im Editor aktualisiert die Vorschau, ohne die Leseposition zu verlieren.
          </span>
        </span>
      </label>

      <div className="field">
        <label htmlFor="data-actions">Daten</label>
        <div className="row" id="data-actions">
          <button type="button" className="btn" onClick={() => prune.mutate()}>
            Verwaiste Einträge entfernen
          </button>
          <button type="button" className="btn" onClick={() => backup.mutate()}>
            <Save size={14} /> Daten sichern
          </button>
          <button type="button" className="btn" onClick={() => showLog.mutate()}>
            <FileClock size={14} /> Protokoll zeigen
          </button>
        </div>
        <span className="tiny muted">
          Datenbank: {info.data?.databasePath ?? "…"}
        </span>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘O", "Datei öffnen"],
  ["⌘⇧O", "Ordner öffnen"],
  ["⌘R", "Dokument neu laden"],
  ["⌘F", "Im Dokument suchen"],
  ["⌘1", "Seitenleiste ein-/ausblenden"],
  ["⌘2", "Inhaltsverzeichnis ein-/ausblenden"],
  ["⌘3", "Seitenleiste: Verlauf ↔ Ordner"],
  ["↑ ↓ → ←", "Im Ordnerbaum bewegen, Enter öffnet"],
  ["⌘←  /  ⌘→", "Zurück / vorwärts im Dokumentverlauf"],
  ["⌘+  /  ⌘-  /  ⌘0", "Schrift größer / kleiner / normal"],
  ["⌘⇧L", "Hell / Dunkel"],
  ["⌘⌥R", "Im Finder zeigen"],
  ["⌘P", "Drucken oder als PDF sichern"],
  ["⌘,", "Einstellungen"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Tastenkürzel"
      icon={<Keyboard size={15} />}
      onClose={onClose}
      description="Alle Kürzel stehen auch im nativen Menü."
    >
      <dl className="kv">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="kv-row">
            <dt>
              <span className="kbd">{keys}</span>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const info = useQuery(infoQuery);
  const log = useQuery(logQuery);

  return (
    <Modal
      title={`Über ${info.data?.name ?? "Markdown-Betrachter"}`}
      icon={<Info size={15} />}
      onClose={onClose}
      description="Version und Pfade dieser Installation."
    >
      <dl className="kv">
        <dt>Version</dt>
        <dd className="num">{info.data?.version}</dd>
        <dt>Baudatum</dt>
        <dd className="num">{info.data?.buildDate}</dd>
        <dt>Commit</dt>
        <dd className="num">{info.data?.commit}</dd>
        <dt>Deno</dt>
        <dd className="num">{info.data?.deno}</dd>
        <dt>Datenbank</dt>
        <dd className="tiny">{info.data?.databasePath}</dd>
        <dt>Protokoll</dt>
        <dd className="tiny">{log.data?.path ?? info.data?.logPath}</dd>
      </dl>
    </Modal>
  );
}
