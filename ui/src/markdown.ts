/**
 * Markdown → HTML, im Webview.
 *
 * Warum hier und nicht auf dem Server: Mermaid und KaTeX brauchen ein DOM, und
 * beim Blättern durch den Verlauf soll die Vorschau nicht auf eine Antwort
 * warten. Der Server liefert Text und Pfade, das Rendern passiert lokal.
 *
 * Die Kette ist bewusst eine einzige Datei, weil jeder Schritt vom vorigen
 * abhängt:
 *
 *   Vorspann trennen → marked (GFM, Fußnoten, KaTeX) → eigene Renderer für
 *   Code/Bild/Link/Überschrift → **DOMPurify** → HTML + Inhaltsverzeichnis
 *
 * Der Sanitizer ist keine Formalie: Ein Betrachter zeigt fremde Dateien an.
 * `<img src=x onerror=…>` ist gültiges Markdown-Durchreichen, und ohne
 * Reinigung liefe das Skript mit dem App-Token im selben Fenster.
 */
import { Marked, type Tokens } from "marked";
import markedFootnote from "marked-footnote";
import markedKatex from "marked-katex-extension";
// `highlight.js/lib/common` statt des vollen Pakets: Das volle Paket bringt
// ~190 Sprachen mit (rund 1 MB im Bündel), `common` die knapp 40, die in
// Dokumentation praktisch vorkommen. Unbekannte Sprachen werden nicht
// hervorgehoben — der Codeblock sieht trotzdem richtig aus.
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { assetUrl } from "./api.ts";

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface Rendered {
  html: string;
  headings: Heading[];
  /** Schlüssel/Wert aus dem YAML-Vorspann — wird als Tabelle über dem Text gezeigt. */
  frontmatter: { key: string; value: string }[];
  /** Anzahl gefundener Mermaid-Blöcke; der Betrachter zeichnet sie nach dem Einsetzen. */
  diagrams: number;
}

export interface RenderContext {
  /** Ordner des Dokuments — Grundlage für relative Bild- und Dateipfade. */
  dir: string;
}

// ── Vorspann ────────────────────────────────────────────────────────────────

/**
 * YAML-Vorspann abtrennen. Bewusst zeilenweise und ohne YAML-Parser: Der
 * Vorspann wird angezeigt, nicht ausgewertet — verschachtelte Strukturen
 * landen als Text in der Wertspalte, und das ist für eine Vorschau richtig.
 */
function splitFrontmatter(text: string): { body: string; frontmatter: Rendered["frontmatter"] } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { body: text, frontmatter: [] };
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 1) return { body: text, frontmatter: [] };

  const frontmatter: Rendered["frontmatter"] = [];
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      // Fortsetzungszeile (Listenpunkt, eingerückter Wert) an den letzten Wert hängen.
      const last = frontmatter[frontmatter.length - 1];
      if (last && line.trim()) last.value = `${last.value} ${line.trim().replace(/^-\s*/, "")}`.trim();
      continue;
    }
    frontmatter.push({ key: match[1], value: match[2].trim().replace(/^["']|["']$/g, "") });
  }
  return { body: lines.slice(end + 1).join("\n"), frontmatter };
}

// ── Hilfen ──────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Anker aus einer Überschrift. Gleiche Überschriften bekommen `-1`, `-2` … —
 * ohne den Zähler springt das Inhaltsverzeichnis bei zwei „Beispiel"-Kapiteln
 * immer zum ersten.
 */
function slugger() {
  const seen = new Map<string, number>();
  return (value: string): string => {
    const base = value
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "abschnitt";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

const EXTERNAL = /^(https?:|mailto:)/i;
const ABSOLUTE_ASSET = /^(https?:|data:|blob:)/i;
const MARKDOWN_LINK = /\.(md|markdown|mdown|mkd|mdx|txt)(#.*)?$/i;

// ── Rendern ─────────────────────────────────────────────────────────────────

export function renderMarkdown(text: string, context: RenderContext): Rendered {
  const { body, frontmatter } = splitFrontmatter(text);
  const headings: Heading[] = [];
  const slug = slugger();
  let diagrams = 0;

  // Eine Instanz **pro Aufruf**: Der Slugger und die Überschriftenliste sind
  // Zustand. Eine wiederverwendete Marked-Instanz würde Anker über Dokumente
  // hinweg weiterzählen (`einleitung-7`).
  const marked = new Marked({ gfm: true, breaks: false });

  marked.use(markedFootnote({ description: "Fußnoten" }));
  marked.use(
    markedKatex({
      throwOnError: false,
      // `$…$` ist keine offizielle Markdown-Syntax, aber die verbreitetste
      // Schreibweise für Formeln im Fließtext — ohne das Flag bleibt sie roh.
      nonStandard: true,
      output: "html",
    }),
  );

  marked.use({
    renderer: {
      code(token: Tokens.Code): string {
        const language = (token.lang ?? "").trim().split(/\s+/)[0].toLowerCase();

        // Mermaid wird nicht als Code ausgegeben, sondern als Platzhalter, den
        // `<Viewer>` nach dem Einsetzen ins DOM zeichnen lässt. Der Quelltext
        // steht dabei URL-kodiert im `data-`Attribut, damit er den Sanitizer
        // unverändert übersteht.
        if (language === "mermaid") {
          diagrams++;
          return `<div class="diagram" data-diagram="${encodeURIComponent(token.text)}"></div>`;
        }

        const known = language && hljs.getLanguage(language);
        const highlighted = known
          ? hljs.highlight(token.text, { language, ignoreIllegals: true }).value
          : escapeHtml(token.text);
        const label = known ? language : "";
        return `<figure class="code-block"${label ? ` data-language="${escapeHtml(label)}"` : ""}>` +
          `<pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${highlighted}` +
          `</code></pre></figure>`;
      },

      heading(token: Tokens.Heading): string {
        const text = this.parser.parseInline(token.tokens);
        // Für Anker und Inhaltsverzeichnis zählt der reine Text, nicht die
        // Auszeichnung — `## **Wichtig**` soll `wichtig` ergeben.
        const plain = token.text.replace(/[*_`~]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
        const id = slug(plain);
        headings.push({ id, text: plain, level: token.depth });
        return `<h${token.depth} id="${id}">${text}` +
          `<a class="anchor" href="#${id}" aria-label="Link zu diesem Abschnitt">#</a>` +
          `</h${token.depth}>`;
      },

      /**
       * Bilder stehen relativ zum Dokument. Eine `file://`-URL kann das
       * Webview nicht laden (fremde Herkunft, von der CSP ausgeschlossen) —
       * deshalb geht der Verweis über den eigenen Server (`/api/asset`).
       */
      image(token: Tokens.Image): string {
        const source = ABSOLUTE_ASSET.test(token.href) ? token.href : assetUrl(context.dir, token.href);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${escapeHtml(source)}" alt="${escapeHtml(token.text ?? "")}"${title} ` +
          `loading="lazy" class="md-image" />`;
      },

      /**
       * Drei Sorten Link, drei Ziele: Anker bleiben im Dokument, Verweise auf
       * andere Markdown-Dateien öffnen diese im Betrachter, alles Übrige geht
       * in den Standardbrowser. Entschieden wird hier, ausgeführt in
       * `<Viewer>` — hier gibt es kein `fetch`.
       */
      link(token: Tokens.Link): string {
        const href = token.href ?? "";
        const label = this.parser.parseInline(token.tokens);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        if (href.startsWith("#")) return `<a href="${escapeHtml(href)}"${title}>${label}</a>`;
        if (EXTERNAL.test(href)) {
          return `<a href="${escapeHtml(href)}" data-external="${escapeHtml(href)}"${
            title || ` title="${escapeHtml(href)}"`
          }>${label}</a>`;
        }
        if (MARKDOWN_LINK.test(href)) {
          return `<a href="#" data-doc="${escapeHtml(href)}" title="${escapeHtml(href)}">${label}</a>`;
        }
        // Verweis auf eine andere lokale Datei (PDF, Bild): über den Server.
        return `<a href="${escapeHtml(assetUrl(context.dir, href))}" data-asset="1"${title}>${label}</a>`;
      },
    },
  });

  const raw = marked.parse(body, { async: false }) as string;

  /**
   * Reinigung. `data-*` lässt DOMPurify von Haus aus stehen (davon leben die
   * Diagramm- und Link-Platzhalter oben); ausdrücklich erlaubt werden müssen
   * nur die Ziel-Attribute für Tabellen und die von KaTeX erzeugte
   * MathML-Struktur.
   */
  const html = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ["target", "rel", "colspan", "rowspan", "align", "start", "loading"],
    // `id` wird für die Sprungmarken gebraucht; ohne das Flag hängt DOMPurify
    // bei mehreren Dokumenten nacheinander einen Präfix an und die Anker im
    // Inhaltsverzeichnis zeigen ins Leere.
    SANITIZE_NAMED_PROPS: false,
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
  });

  return { html, headings, frontmatter, diagrams };
}

// ── Mermaid ─────────────────────────────────────────────────────────────────

let mermaidLoaded: Promise<typeof import("mermaid").default> | null = null;
let mermaidTheme: "dark" | "default" | null = null;

/**
 * Mermaid wird **nachgeladen**, nicht mitgebündelt-und-sofort-ausgeführt: Es
 * ist mit Abstand die größte Abhängigkeit der Oberfläche, und die meisten
 * Dokumente enthalten kein einziges Diagramm. Der erste Aufruf zahlt, alle
 * weiteren nicht.
 */
async function getMermaid(dark: boolean) {
  if (!mermaidLoaded) mermaidLoaded = import("mermaid").then((module) => module.default);
  const mermaid = await mermaidLoaded;
  const theme = dark ? "dark" : "default";
  if (mermaidTheme !== theme) {
    mermaidTheme = theme;
    mermaid.initialize({
      startOnLoad: false,
      theme,
      // `strict` erlaubt Mermaid kein HTML in Beschriftungen — bei fremden
      // Dokumenten die richtige Vorgabe.
      securityLevel: "strict",
      fontFamily: "inherit",
      /**
       * **Beschriftungen als SVG-Text, nicht als HTML.** Standardmäßig setzt
       * Mermaid jede Beschriftung als HTML in ein `<foreignObject>`. Durch die
       * Reinigung unten kommt davon nichts an: DOMPurify wirft den
       * HTML-Inhalt im SVG weg, und im Fenster stehen dann Kästchen und
       * Pfeile **ohne Text** — ohne Fehlermeldung, was den Fehler besonders
       * unangenehm macht. Mit `htmlLabels: false` erzeugt Mermaid echte
       * `<text>`-Elemente, die das SVG-Profil unverändert durchlässt.
       */
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      class: { htmlLabels: false },
    });
  }
  return mermaid;
}

/**
 * Zeichnet alle Platzhalter aus `renderMarkdown` in einem Container.
 *
 * Fehler bleiben **im Diagramm**: Ein Tippfehler in einem von zwanzig
 * Diagrammen darf nicht die ganze Seite kosten. Angezeigt wird dann die
 * Fehlermeldung samt Quelltext — das ist genau das, was man zum Korrigieren
 * braucht.
 */
export async function drawDiagrams(
  container: HTMLElement,
  dark: boolean,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(".diagram[data-diagram]"));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid(dark);
  // Zwischen dem ersten `await` und hier kann ein anderes Dokument geöffnet
  // worden sein — dann gehört der Teilbaum bereits dem nächsten Durchlauf.
  if (cancelled()) return;

  await Promise.all(blocks.map(async (block, index) => {
    const source = decodeURIComponent(block.dataset.diagram ?? "");
    try {
      // Die ID muss im Dokument eindeutig sein — Mermaid legt darüber seine
      // Stil-Regeln ab.
      const { svg } = await mermaid.render(
        `diagramm-${index}-${Math.random().toString(36).slice(2, 8)}`,
        source,
      );
      if (cancelled()) return;
      // Reines SVG-Profil — möglich, weil Mermaid oben auf HTML-Beschriftungen
      // verzichtet. Das `<style>`-Element im SVG bleibt dabei erhalten; daran
      // hängen die Farben des Diagramms.
      block.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      block.classList.add("ready");
    } catch (error) {
      if (cancelled()) return;
      block.classList.add("failed");
      block.textContent = "";
      const message = document.createElement("p");
      message.className = "diagram-error";
      message.textContent = `Mermaid: ${error instanceof Error ? error.message : String(error)}`;
      const code = document.createElement("pre");
      code.textContent = source;
      block.append(message, code);
    }
  }));
}
