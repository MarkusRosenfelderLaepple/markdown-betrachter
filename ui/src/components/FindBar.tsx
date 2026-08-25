/**
 * Suchen im Dokument (⌘F).
 *
 * Gesucht wird über `window.find()` — die alte, in WebKit und Chromium
 * vorhandene Browserfunktion. Der Grund gegen eine eigene Umsetzung: Selbst
 * markieren hieße, im gereinigten HTML Textknoten aufzuteilen und `<mark>`
 * einzusetzen — mitten in einem Dokument, das gerade von Mermaid und KaTeX
 * angefasst wird. `window.find()` markiert über die Auswahl des Browsers,
 * scrollt selbst dorthin und lässt das DOM in Ruhe.
 */
import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { viewer, viewerStore } from "../store/viewer.ts";

interface FindWindow {
  find?(
    text: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
  ): boolean;
}

export function FindBar() {
  const open = useStore(viewerStore, (state) => state.findOpen);
  const term = useStore(viewerStore, (state) => state.find);
  const input = useRef<HTMLInputElement>(null);
  const missing = useRef(false);

  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);

  if (!open) return null;

  const step = (backwards: boolean) => {
    const value = term.trim();
    if (!value) return;
    const search = (globalThis as unknown as FindWindow).find;
    if (!search) {
      missing.current = true;
      return;
    }
    // Vor der Suche die Auswahl aufheben: Sonst sucht `find()` ab dem Ende der
    // letzten Fundstelle und findet dieselbe Stelle beim Tippen nie wieder.
    if (!backwards) globalThis.getSelection()?.removeAllRanges();
    search.call(globalThis, value, false, backwards, true);
  };

  const close = () => {
    globalThis.getSelection()?.removeAllRanges();
    viewer.openFind(false);
  };

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
      <button type="button" className="btn ghost icon" title="Rückwärts (⇧⏎)" onClick={() => step(true)}>
        <ChevronUp size={14} />
      </button>
      <button type="button" className="btn ghost icon" title="Weiter (⏎)" onClick={() => step(false)}>
        <ChevronDown size={14} />
      </button>
      <button type="button" className="btn ghost icon" title="Schließen (Esc)" onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
}
