/**
 * Fundstellen im offenen Dokument sammeln und markieren.
 *
 * Vorher lief die Suche über `window.find()`. Das hat zwei Fehler, die man
 * beim Benutzen sofort merkt: Sie durchsucht das **ganze** Fenster — also auch
 * die Dateinamen in der Seitenleiste und das Inhaltsverzeichnis — und sie
 * zeigt immer nur *eine* Stelle, und die erst nach einem Druck auf die Pfeile.
 *
 * Deshalb hier eigene Fundstellen als `Range`, markiert über die CSS Custom
 * Highlight API. Der Punkt an dieser API: Sie hängt die Markierung **neben**
 * das DOM, nicht hinein. Genau das war der Einwand gegen eine eigene Suche —
 * Textknoten aufteilen und `<mark>` einsetzen, während Mermaid und KaTeX am
 * selben Teilbaum arbeiten. Das entfällt: Der Baum bleibt unangetastet, und
 * die Markierung verschwindet mit einem `delete` wieder.
 */

// ── Minimal-Typisierung der Highlight-API ───────────────────────────────────
// Wie in `src/window.ts`: nur die Felder, die hier benutzt werden. Die API ist
// je nach Webview-Alter gar nicht da — das ist unten der Rückfallweg.

interface HighlightObject {
  priority: number;
}

type HighlightConstructor = new (...ranges: Range[]) => HighlightObject;

const HighlightCtor = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight;
const registry = (CSS as unknown as { highlights?: Map<string, HighlightObject> }).highlights;

/** Ob alle Treffer gleichzeitig gelb markiert werden können. */
export const canHighlight = Boolean(HighlightCtor && registry);

const ALL = "find-all";
const CURRENT = "find-current";

// ── Textverzeichnis ─────────────────────────────────────────────────────────

/**
 * Nicht durchsucht wird, was zwar Text ist, aber keiner *des Dokuments*:
 * Mermaid-Beschriftungen liegen im SVG (dort greift die Markierung nicht),
 * `.katex-mathml` ist die unsichtbare Zweitfassung jeder Formel — ohne diesen
 * Ausschluss findet man jede Formel doppelt — und `.code-copy` ist der
 * nachträglich angehängte Knopf, nicht der Code.
 */
const SKIP = "svg, .katex-mathml, .code-copy, script, style";

interface Chunk {
  node: Text;
  /** Startposition dieses Knotens im zusammengesetzten Text. */
  start: number;
}

interface TextIndex {
  /** Der gesamte sichtbare Text, kleingeschrieben (gesucht wird ohne Rücksicht auf Groß/Klein). */
  text: string;
  chunks: Chunk[];
}

/**
 * Alle Textknoten in *einer* Zeichenkette zusammenlegen, mit Rückweg zum
 * jeweiligen Knoten. Der Grund für den Umweg: Ein Suchwort steht im HTML
 * regelmäßig über Knotengrenzen hinweg — „**fett**gedruckt" sind drei Knoten.
 * Wer je Knoten einzeln sucht, findet solche Stellen nie.
 */
function buildIndex(root: Element): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const chunks: Chunk[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    chunks.push({ node: node as Text, start: text.length });
    text += node.nodeValue;
  }
  return { text: text.toLowerCase(), chunks };
}

/** Der Knoten, in dem die Position `offset` liegt — binäre Suche über die Startpositionen. */
function chunkAt(chunks: Chunk[], offset: number): number {
  let low = 0;
  let high = chunks.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (chunks[mid].start <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function rangeFor(chunks: Chunk[], from: number, to: number): Range {
  const range = document.createRange();
  const first = chunkAt(chunks, from);
  const last = chunkAt(chunks, to - 1);
  range.setStart(chunks[first].node, from - chunks[first].start);
  range.setEnd(chunks[last].node, to - chunks[last].start);
  return range;
}

/**
 * Alle Fundstellen unterhalb von `root`, in Lesereihenfolge. Gesucht wird als
 * einfache Zeichenkette, nicht als Muster: Wer im Dokument nach `foo(bar)`
 * sucht, meint genau das und keinen regulären Ausdruck.
 */
export function findMatches(root: Element, term: string): Range[] {
  const needle = term.toLowerCase();
  if (!needle) return [];

  const { text, chunks } = buildIndex(root);
  const found: Range[] = [];
  // Obergrenze gegen den Fall, den man beim Tippen aus Versehen trifft: ein
  // einzelnes Leerzeichen in einem langen Dokument sind zehntausende Treffer,
  // und die alle zu markieren kostet mehr Zeit, als das Ergebnis wert ist.
  for (let at = text.indexOf(needle); at !== -1 && found.length < 2000;) {
    found.push(rangeFor(chunks, at, at + needle.length));
    at = text.indexOf(needle, at + needle.length);
  }
  return found;
}

// ── Markieren ───────────────────────────────────────────────────────────────

/**
 * Treffer anzeigen: alle gelb, der aktuelle kräftiger. Ohne die Highlight-API
 * (ältere Webviews) bleibt die Auswahl des Browsers als Rückfallweg — sie
 * zeigt nur den aktuellen Treffer, ist aber immerhin auf das Dokument
 * beschränkt und damit immer noch richtiger als `window.find()`.
 */
export function paintMatches(matches: Range[], current: Range | null): void {
  if (!HighlightCtor || !registry) {
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    if (current) selection?.addRange(current.cloneRange());
    return;
  }

  registry.delete(ALL);
  registry.delete(CURRENT);
  if (matches.length === 0) return;

  registry.set(ALL, new HighlightCtor(...matches));
  if (current) {
    const highlight = new HighlightCtor(current);
    // Beide Markierungen liegen auf derselben Stelle; ohne Vorrang entscheidet
    // die Reihenfolge der Registrierung, und die ist kein Versprechen.
    highlight.priority = 1;
    registry.set(CURRENT, highlight);
  }
}

export function clearMatches(): void {
  if (registry) {
    registry.delete(ALL);
    registry.delete(CURRENT);
  } else {
    globalThis.getSelection()?.removeAllRanges();
  }
}

// ── Hinscrollen ─────────────────────────────────────────────────────────────

/**
 * Zum Treffer scrollen — aber nur, wenn er nicht ohnehin gut sichtbar ist.
 * Bedingungslos zu scrollen lässt die Seite bei jedem Weiterklicken zucken,
 * auch wenn der nächste Treffer zwei Zeilen tiefer steht.
 *
 * Der obere Rand ist großzügig: Dort klebt die Suchleiste, ein Treffer direkt
 * darunter wäre halb verdeckt.
 *
 * `instant` ist Absicht, gleich doppelt: `.doc-scroll` trägt in `styles.css`
 * ein `scroll-behavior: smooth`, das hier ausdrücklich überschrieben werden
 * muss — nachgemessen, sonst bleibt der Sprung beim schnellen Weiterklicken
 * (⏎ gedrückt halten) schlicht liegen, weil jede neue Animation die vorige
 * ablöst und keine ankommt. Und es ist auch das erwartete Verhalten: Die
 * Suchfunktion des Browsers springt ebenfalls hart zum nächsten Treffer.
 */
export function revealMatch(range: Range, scroller: Element | null): void {
  if (!scroller) return;
  const rect = range.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return;
  const box = scroller.getBoundingClientRect();
  const top = box.top + 80;
  const bottom = box.bottom - 40;
  if (rect.top >= top && rect.bottom <= bottom) return;
  scroller.scrollBy({ top: rect.top - box.top - box.height / 3, behavior: "instant" });
}
