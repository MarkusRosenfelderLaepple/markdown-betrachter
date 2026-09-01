/**
 * Suchen im Dokument (⌘F).
 *
 * Gesucht wird ausschließlich im offenen Dokument — nicht in Seitenleiste,
 * Verlauf oder Inhaltsverzeichnis. Das war der eigentliche Fehler der früheren
 * Fassung: `window.find()` kennt nur „das Fenster" und traf deshalb auch
 * Dateinamen nebenan. Die Fundstellen kommen jetzt aus `find.ts`, das den Text
 * unterhalb von `.doc` durchsucht und `Range`-Objekte zurückgibt.
 *
 * Markiert wird sofort beim Tippen, alle Treffer gleichzeitig; die Pfeile
 * wechseln nur noch zwischen ihnen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { clearMatches, findMatches, paintMatches, revealMatch } from "../find.ts";
import { viewer, viewerStore } from "../store/viewer.ts";

export function FindBar() {
  const open = useStore(viewerStore, (state) => state.findOpen);
  const term = useStore(viewerStore, (state) => state.find);
  // Beides zusammen macht „ein anderer Inhalt" aus: anderes Dokument, oder
  // dieselbe Datei nach dem Speichern im Editor.
  const path = useStore(viewerStore, (state) => state.doc?.path ?? "");
  const modified = useStore(viewerStore, (state) => state.doc?.modifiedAt ?? "");

  const input = useRef<HTMLInputElement>(null);
  const [matches, setMatches] = useState<Range[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);

  /** Neuer Suchbegriff, neues Dokument: wieder beim ersten Treffer anfangen. */
  useEffect(() => {
    setCurrent(0);
  }, [term, path, modified, open]);

  /**
   * Fundstellen sammeln — und zwar erneut, sobald sich der Inhalt ändert.
   *
   * Zwei Gründe, die beide beim Ausprobieren aufgefallen sind. Erstens setzt
   * `Viewer` das HTML in einem *eigenen* Effekt, und der läuft — als Nachbar
   * weiter unten im Baum — nach diesem hier; ohne das Warten auf den nächsten
   * Bildaufbau durchsucht die Suche beim Dokumentwechsel noch den vorigen
   * Inhalt. Zweitens baut derselbe Effekt den Teilbaum auch beim Wechsel
   * zwischen Hell und Dunkel neu auf (der Diagramme wegen) — danach zeigen
   * alle gemerkten `Range`-Objekte auf Knoten, die nicht mehr im Dokument
   * hängen, und die Markierung ist ersatzlos weg.
   *
   * Der Beobachter fängt beide Fälle ab, ohne dass diese Datei wissen muss,
   * *warum* neu gezeichnet wurde. Ausgenommen ist die Suchleiste selbst: Sie
   * liegt mit im beobachteten Bereich, und ihre eigene Trefferanzeige darf die
   * Suche nicht erneut auslösen.
   */
  useEffect(() => {
    if (!open || !term.trim()) {
      setMatches([]);
      return;
    }
    let frame = 0;
    const scan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.querySelector(".doc");
        setMatches(root ? findMatches(root, term.trim()) : []);
      });
    };
    scan();

    const observer = new MutationObserver((records) => {
      if (records.every((record) => (record.target as Element).parentElement?.closest(".findbar"))) return;
      scan();
    });
    const area = document.querySelector(".doc-scroll");
    if (area) observer.observe(area, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, term, path, modified]);

  /**
   * Markierung und Sprung folgen dem Zustand — nicht dem Tastendruck. Der
   * Index wird dabei eingefangen: Nach einem Neuaufbau kann es weniger Treffer
   * geben als vorher.
   */
  useEffect(() => {
    const active = matches[Math.min(current, matches.length - 1)] ?? null;
    paintMatches(matches, active);
    if (active) revealMatch(active, document.querySelector(".doc-scroll"));
  }, [matches, current]);

  /** Beim Schließen (und beim Verlassen der App) bleibt keine Markierung stehen. */
  useEffect(() => clearMatches, []);

  const close = useCallback(() => {
    clearMatches();
    viewer.openFind(false);
  }, []);

  useEffect(() => {
    if (!open) clearMatches();
  }, [open]);

  if (!open) return null;

  const step = (backwards: boolean) => {
    if (matches.length === 0) return;
    setCurrent((index) => (index + (backwards ? -1 : 1) + matches.length) % matches.length);
  };

  const empty = !term.trim();

  return (
    <div className="findbar">
      <Search size={14} className="muted" />
      <input
        ref={input}
        className="input"
        placeholder="Im Dokument suchen …"
        value={term}
        aria-label="Im Dokument suchen"
        onChange={(event) => {
          viewer.setFind(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      />
      <span className={`find-count tiny ${!empty && matches.length === 0 ? "warn-text" : "muted"}`}>
        {empty
          ? ""
          : matches.length === 0
          ? "keine Treffer"
          : `${Math.min(current, matches.length - 1) + 1}/${matches.length}`}
      </span>
      <button
        type="button"
        className="btn ghost icon"
        title="Rückwärts (⇧⏎)"
        disabled={matches.length === 0}
        onClick={() => step(true)}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="btn ghost icon"
        title="Weiter (⏎)"
        disabled={matches.length === 0}
        onClick={() => step(false)}
      >
        <ChevronDown size={14} />
      </button>
      <button type="button" className="btn ghost icon" title="Schließen (Esc)" onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
}
