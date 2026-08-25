/**
 * Die Vorschau selbst: gerendertes Markdown, Diagramme, Klickverhalten.
 *
 * **Warum das Markdown-HTML hier von Hand ins DOM geht und nicht über
 * `dangerouslySetInnerHTML`:** Nach dem Einsetzen wird an diesem Teilbaum
 * weitergearbeitet — Mermaid ersetzt Platzhalter durch SVG, an jeden Codeblock
 * kommt ein „Kopieren"-Knopf. React weiß von diesen Änderungen nichts. Sobald
 * es die Eigenschaft erneut anwendet (und das tut es bei jedem Rendern, dessen
 * HTML-Zeichenkette es für neu hält), ersetzt es den kompletten Inhalt —
 * gemessen: 31 Knoten raus, 31 rein, Diagramme weg, ohne Fehlermeldung.
 *
 * Deshalb hat dieser Knoten **einen** Besitzer: der Effekt unten. Er setzt das
 * HTML, hängt an, beobachtet, und räumt beim Wechsel auf. Es ist zugleich die
 * einzige Stelle der App, die HTML aus einer Datei ins Dokument bringt — der
 * Sanitizer sitzt entsprechend direkt davor, in `markdown.ts`.
 */
import { useEffect, useMemo, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { FileText, FolderOpen, Keyboard } from "lucide-react";
import type { Doc } from "../../../shared/schema.ts";
import { drawDiagrams, type Heading, renderMarkdown } from "../markdown.ts";
import { client, errorMessage, unwrap } from "../api.ts";
import { resolveDark, toast, uiStore } from "../store/ui.ts";
import { viewer } from "../store/viewer.ts";

export interface ViewerProps {
  doc: Doc;
  /** Meldet das Inhaltsverzeichnis nach oben — die Seitenleiste zeichnet es. */
  onHeadings: (headings: Heading[]) => void;
  /** Sichtbarer Abschnitt für die Markierung im Inhaltsverzeichnis. */
  onActiveHeading: (id: string | null) => void;
}

export function Viewer({ doc, onHeadings, onActiveHeading }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useStore(uiStore, (state) => state.settings.theme);

  /**
   * Rendern ist reine Rechenarbeit auf dem Text — `useMemo` hält sie aus dem
   * Weg, wenn nur die Fensterbreite oder ein Menü sich ändert. Die Änderungs-
   * zeit gehört in die Abhängigkeiten: Nach dem Speichern im Editor ist der
   * Pfad derselbe, der Inhalt nicht.
   */
  const rendered = useMemo(
    () => renderMarkdown(doc.text, { dir: doc.dir }),
    [doc.path, doc.dir, doc.modifiedAt, doc.text],
  );

  useEffect(() => {
    onHeadings(rendered.headings);
  }, [rendered, onHeadings]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const cleanups: (() => void)[] = [];

    // 1. HTML einsetzen. Ab hier gehört der Teilbaum diesem Effekt.
    node.innerHTML = rendered.html;

    // 2. „Kopieren" an jeden Codeblock. Nachträglich angehängt und nicht beim
    //    Rendern eingesetzt: Ein `<button onclick=…>` im gereinigten HTML
    //    hätte keine Wirkung — der Sanitizer entfernt Attribute mit Code, und
    //    das soll er auch.
    for (const block of node.querySelectorAll<HTMLElement>(".code-block")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy";
      button.textContent = "Kopieren";
      const onCopy = () => {
        const code = block.querySelector("code")?.textContent ?? "";
        void navigator.clipboard.writeText(code)
          .then(() => {
            button.textContent = "Kopiert";
            setTimeout(() => (button.textContent = "Kopieren"), 1200);
          })
          .catch(() => toast.error("Zwischenablage nicht verfügbar"));
      };
      button.addEventListener("click", onCopy);
      block.append(button);
      cleanups.push(() => button.removeEventListener("click", onCopy));
    }

    /**
     * 3. Klicks auf Links — ein Zuhörer am Container statt Hunderter an den
     *    Links. Drei Sorten, drei Ziele (entschieden wurde beim Rendern):
     *    Anker bleiben im Dokument, `.md` öffnet im Betrachter, alles Externe
     *    geht in den Standardbrowser. Ohne den letzten Punkt würde ein Klick
     *    die App-Seite im Fenster **ersetzen** — ohne Zurück-Knopf.
     */
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (!link) return;

      const external = link.dataset.external;
      if (external) {
        event.preventDefault();
        void unwrap(client.api["open-external"].$post({ json: { url: external } }))
          .catch((error) => toast.error(errorMessage(error)));
        return;
      }

      const relative = link.dataset.doc;
      if (relative) {
        event.preventDefault();
        const [target, fragment] = relative.split("#");
        // `decodeURI`, weil Markdown-Links Leerzeichen kodieren.
        void viewer.open(resolvePath(doc.dir, decodeURI(target))).then(() => {
          if (fragment) requestAnimationFrame(() => jumpTo(fragment));
        });
        return;
      }

      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        event.preventDefault();
        jumpTo(href.slice(1));
      }
      // Beigaben (`data-asset`) gehen als normaler Aufruf an den eigenen
      // Server — das Webview zeigt PDF und Bild selbst an.
    };
    node.addEventListener("click", onClick);
    cleanups.push(() => node.removeEventListener("click", onClick));

    /**
     * 4. Sichtbaren Abschnitt melden. `IntersectionObserver` statt eines
     *    `scroll`-Zuhörers: Der feuert bei jedem Pixel, und die Positionen
     *    aller Überschriften jedes Mal neu auszurechnen macht das Scrollen
     *    ruckelig. `rootMargin` schneidet unten 70 % weg — sonst gilt beim
     *    Herunterscrollen die *unterste* sichtbare Überschrift als aktiv, und
     *    die Markierung läuft dem Text voraus.
     */
    if (rendered.headings.length > 0) {
      const visible = new Set<string>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target.id);
            else visible.delete(entry.target.id);
          }
          const active = rendered.headings.find((heading) => visible.has(heading.id));
          onActiveHeading(active?.id ?? null);
        },
        { root: node.closest(".doc-scroll"), rootMargin: "0px 0px -70% 0px", threshold: 0 },
      );
      for (const heading of rendered.headings) {
        const element = node.querySelector(`#${CSS.escape(heading.id)}`);
        if (element) observer.observe(element);
      }
      cleanups.push(() => observer.disconnect());
    }

    // 5. Diagramme zeichnen. Läuft asynchron weiter, nachdem der Effekt
    //    zurückgekehrt ist — deshalb der Abbruchschalter: Wird währenddessen
    //    ein anderes Dokument geöffnet, gehört der Teilbaum schon dem nächsten
    //    Durchlauf, und das späte Ergebnis darf ihn nicht überschreiben.
    let cancelled = false;
    void drawDiagrams(node, resolveDark(theme), () => cancelled)
      .catch((error) => {
        if (!cancelled) toast.error("Diagramme konnten nicht gezeichnet werden", errorMessage(error));
      });
    cleanups.push(() => {
      cancelled = true;
    });

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [rendered, theme, doc.dir, onActiveHeading]);

  /**
   * Nach oben springen, wenn ein *anderes* Dokument kommt — aber nicht beim
   * automatischen Neuladen derselben Datei: Wer beim Schreiben in Abschnitt 7
   * steht, will nach dem Speichern dort bleiben.
   */
  useEffect(() => {
    host.current?.closest(".doc-scroll")?.scrollTo({ top: 0 });
  }, [doc.path]);

  return (
    <article className="doc">
      {rendered.frontmatter.length > 0 && (
        <dl className="frontmatter">
          {rendered.frontmatter.map((entry) => (
            <div key={entry.key}>
              <dt>{entry.key}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {/* Inhalt wird im Effekt oben gesetzt — React fasst diesen Knoten nicht an. */}
      <div className="markdown" ref={host} />
    </article>
  );
}

/** Anker anspringen, ohne die Adresse zu ändern (es gibt keine Adresse). */
export function jumpTo(id: string): void {
  const target = document.getElementById(id) ?? document.querySelector(`[id="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * `../notizen/plan.md` gegen den Ordner des Dokuments auflösen. Bewusst
 * schlicht: Der Server prüft den Pfad ohnehin noch einmal, hier geht es nur
 * darum, aus einem relativen Verweis einen absoluten zu machen.
 */
export function resolvePath(dir: string, reference: string): string {
  if (reference.startsWith("/")) return reference;
  const parts = `${dir}/${reference}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/** Was statt eines Dokuments zu sehen ist, solange keines offen ist. */
export function EmptyViewer({ canPick }: { canPick: boolean }) {
  return (
    <div className="doc-empty">
      <FileText size={40} strokeWidth={1.2} />
      <h2>Kein Dokument geöffnet</h2>
      <p className="muted">
        Öffne eine Markdown-Datei — oder wähle einen Eintrag aus dem Verlauf links.
      </p>
      {canPick && (
        <button type="button" className="btn primary" onClick={() => void viewer.pick()}>
          <FolderOpen size={15} /> Datei öffnen
        </button>
      )}
      <p className="tiny muted shortcut-hint">
        <Keyboard size={13} /> <span className="kbd">⌘O</span> öffnen · <span className="kbd">⌘R</span>{" "}
        neu laden · <span className="kbd">⌘F</span> suchen
      </p>
    </div>
  );
}
