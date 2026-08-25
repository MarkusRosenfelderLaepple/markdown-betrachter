/**
 * Inhaltsverzeichnis: die Seitenleiste rechts.
 *
 * Die Einrückung folgt der **relativen** Tiefe, nicht der absoluten: Ein
 * Dokument, das mit `##` beginnt (weil `#` der Titel im Vorspann ist), wäre
 * sonst durchgehend eingerückt.
 */
import { List } from "lucide-react";
import type { Heading } from "../markdown.ts";
import { jumpTo } from "./Viewer.tsx";

export function Toc({ headings, active }: { headings: Heading[]; active: string | null }) {
  const top = headings.length > 0 ? Math.min(...headings.map((heading) => heading.level)) : 1;

  return (
    <aside className="side toc">
      <div className="side-head">
        <List size={15} />
        <strong>Inhalt</strong>
      </div>
      <nav className="side-list toc-list">
        {headings.length === 0 && <p className="tiny muted side-empty">Keine Überschriften.</p>}
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            className={`toc-item ${active === heading.id ? "active" : ""}`}
            // Tiefer als drei Ebenen wird nicht weiter eingerückt — sonst
            // steht der Text bei `#####` am rechten Rand.
            style={{ paddingLeft: `${8 + Math.min(heading.level - top, 3) * 12}px` }}
            title={heading.text}
            onClick={() => jumpTo(heading.id)}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
