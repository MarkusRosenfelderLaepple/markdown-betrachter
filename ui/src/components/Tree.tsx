/**
 * Der Ordnerbaum: die zweite Ansicht der linken Seitenleiste.
 *
 * Er beantwortet die Frage, die der Verlauf nicht beantworten kann — „was
 * liegt in diesem Projekt überhaupt an Dokumentation?". Der Server liefert den
 * bereits beschnittenen Baum (`src/tree.ts`); hier wird nur noch angezeigt,
 * gefiltert und aufgeklappt.
 *
 * Zwei Entscheidungen, die man im Code sonst suchen müsste:
 *
 * 1. **Der Baum wird zum Zeichnen flachgeklopft.** Aus der Verschachtelung
 *    entsteht eine Liste sichtbarer Zeilen. Das macht die Tastaturbedienung
 *    trivial (↑/↓ ist ein Index) und spart die Rekursion im JSX.
 * 2. **Der Filter erzeugt seinen eigenen Baum.** Passt eine Datei, bleiben ihre
 *    Elternordner stehen und werden aufgeklappt — gefiltert wird über den
 *    ganzen Baum, nicht nur über das gerade Sichtbare.
 */
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { TreeNode } from "../../../shared/schema.ts";
import { errorMessage, tokenUrl } from "../api.ts";
import { invalidateTree, treeQuery } from "../query.ts";
import { fmt } from "../format.ts";
import { toast, uiStore } from "../store/ui.ts";
import { viewer, viewerStore } from "../store/viewer.ts";
import { workspace } from "../store/workspace.ts";

/** Eine gezeichnete Zeile: Knoten plus das, was erst beim Zeichnen feststeht. */
interface Row {
  node: TreeNode;
  depth: number;
  open: boolean;
}

export function Tree() {
  const root = useStore(uiStore, (state) => state.settings.workspaceDir);
  const autoReload = useStore(uiStore, (state) => state.settings.autoReload);
  const openPath = useStore(viewerStore, (state) => state.doc?.path ?? null);
  const tree = useQuery(treeQuery(root));
  const [term, setTerm] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Ordner überwachen ─────────────────────────────────────────────────────

  /**
   * Dasselbe Muster wie beim Dokument (`App.tsx`), nur eine Ebene höher: Der
   * Server meldet Anlegen, Löschen und Umbenennen im Arbeitsordner, und der
   * Baum wird neu eingelesen. Ohne das zeigt die Leiste nach einem `git pull`
   * oder einer neu angelegten Datei einen Stand von vorgestern.
   */
  useEffect(() => {
    if (!root || !autoReload) return;
    const source = new EventSource(tokenUrl("/api/tree/watch", { root }));
    source.addEventListener("change", () => invalidateTree());
    // Wie beim Dokument kein Toast: Die häufigste Ursache ist das Schließen
    // beim Ordnerwechsel, und der Baum bleibt ohne Überwachung benutzbar.
    source.onerror = () => source.close();
    return () => source.close();
  }, [root, autoReload]);

  // ── Filtern und flachklopfen ──────────────────────────────────────────────

  const filtered = useMemo(() => filterTree(tree.data?.nodes ?? [], term.trim().toLowerCase()), [
    tree.data,
    term,
  ]);

  const rows = useMemo(() => {
    // Beim Filtern ist alles offen — sonst müsste man die Treffer erst suchen.
    const isOpen = (node: TreeNode) => (term ? true : !collapsed.has(node.rel));
    return flatten(filtered, isOpen);
  }, [filtered, collapsed, term]);

  const toggle = useCallback((rel: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(rel)) next.add(rel);
      return next;
    });
  }, []);

  const activate = useCallback((node: TreeNode) => {
    if (node.kind === "dir") return toggle(node.rel);
    void viewer.open(node.path).catch((error) => toast.error(errorMessage(error)));
  }, [toggle]);

  // ── Tastatur ──────────────────────────────────────────────────────────────

  /**
   * ↑/↓ läuft über die **sichtbaren** Zeilen, →/← klappt auf und zu, Enter
   * öffnet. Der Zeiger hängt am Index, nicht am Pfad: Nach dem Filtern oder
   * Zuklappen ist er dann zwar auf einer anderen Zeile, aber nie im Nichts.
   */
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const row = rows[cursor];
    const move = (delta: number) => {
      event.preventDefault();
      setCursor((current) => Math.min(rows.length - 1, Math.max(0, current + delta)));
    };
    if (event.key === "ArrowDown") return move(1);
    if (event.key === "ArrowUp") return move(-1);
    if (!row) return;
    if (event.key === "Enter") {
      event.preventDefault();
      return activate(row.node);
    }
    if (event.key === "ArrowRight" && row.node.kind === "dir" && !row.open) {
      event.preventDefault();
      return toggle(row.node.rel);
    }
    if (event.key === "ArrowLeft" && row.node.kind === "dir" && row.open) {
      event.preventDefault();
      return toggle(row.node.rel);
    }
  }, [rows, cursor, activate, toggle]);

  // Die Auswahl darf nicht aus dem sichtbaren Bereich laufen, wenn man mit den
  // Pfeiltasten durch einen langen Baum geht.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".tree-row.cursor")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  useEffect(() => setCursor(0), [term, root]);

  /**
   * Beim ersten Einlesen eines Ordners ist nur die oberste Ebene offen.
   * Vollständig aufgeklappt wäre ein Projekt mit 200 Dokumenten eine Liste von
   * 200 Zeilen — die Gliederung, für die der Baum da ist, wäre wieder weg.
   * `seeded` merkt sich die Wurzel, damit ein Neueinlesen durch den Beobachter
   * nicht das Aufgeklappte des Anwenders zurücksetzt.
   */
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    const nodes = tree.data?.nodes;
    if (!nodes || seeded.current === root) return;
    seeded.current = root;
    const deep = new Set<string>();
    const visit = (list: TreeNode[], depth: number) => {
      for (const node of list) {
        if (node.kind !== "dir") continue;
        if (depth > 0) deep.add(node.rel);
        visit(node.children ?? [], depth + 1);
      }
    };
    visit(nodes, 0);
    setCollapsed(deep);
  }, [tree.data, root]);

  // ── Anzeige ───────────────────────────────────────────────────────────────

  if (!root) {
    return (
      <div className="side-body">
        <div className="side-empty-state">
          <FolderTree size={28} strokeWidth={1.2} className="muted" />
          <p className="tiny muted">Kein Ordner geöffnet.</p>
          <button type="button" className="btn" onClick={() => void workspace.pick()}>
            <FolderTree size={14} /> Ordner öffnen
          </button>
          <p className="tiny muted">
            Der Baum zeigt nur Markdown-Dateien — ignorierte Ordner und alles aus der <code>.gitignore</code>
            {" "}
            bleiben draußen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="side-body">
      <div className="side-head tree-root">
        <FolderTree size={15} />
        <button
          type="button"
          className="tree-root-name"
          title={`${tree.data?.root ?? root}\nKlicken: anderen Ordner öffnen`}
          onClick={() => void workspace.pick()}
        >
          {tree.data?.name ?? fmt.shortPath(root, 1)}
        </button>
        <button
          type="button"
          className="btn ghost icon"
          title="Baum neu einlesen"
          onClick={() => invalidateTree()}
        >
          <RefreshCw size={13} className={tree.isFetching ? "spin" : ""} />
        </button>
        <button type="button" className="btn ghost icon" title="Ordner schließen" onClick={workspace.close}>
          <X size={13} />
        </button>
      </div>

      <div className="side-search">
        <Search size={14} className="muted" />
        <input
          className="input"
          placeholder="Im Ordner filtern …"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Dokumente im Ordner filtern"
        />
        {term && (
          <button
            type="button"
            className="btn ghost icon"
            title="Filter leeren"
            onClick={() => setTerm("")}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {tree.error && (
        <p className="tiny side-empty warn-text">
          <TriangleAlert size={13} /> {errorMessage(tree.error)}
        </p>
      )}

      <div
        className="side-list tree-list"
        ref={listRef}
        tabIndex={0}
        role="tree"
        aria-label="Dokumente im Ordner"
        onKeyDown={onKeyDown}
      >
        {tree.isPending && <p className="tiny muted side-empty">Wird eingelesen …</p>}
        {!tree.isPending && rows.length === 0 && (
          <p className="tiny muted side-empty">
            {term ? "Nichts gefunden." : "Keine Markdown-Dateien in diesem Ordner."}
          </p>
        )}
        {rows.map((row, index) => (
          <TreeRow
            key={row.node.rel}
            row={row}
            active={row.node.path === openPath}
            cursor={index === cursor}
            onSelect={() => {
              setCursor(index);
              activate(row.node);
            }}
          />
        ))}
      </div>

      <div className="side-foot tree-foot tiny muted">
        {tree.data && (
          <span>
            {fmt.int(tree.data.files)} {tree.data.files === 1 ? "Dokument" : "Dokumente"}
          </span>
        )}
        {tree.data?.truncated && (
          <span className="warn-text" title="Der Ordner ist sehr groß — der Baum wurde begrenzt.">
            <TriangleAlert size={12} /> gekürzt
          </span>
        )}
      </div>
    </div>
  );
}

function TreeRow(
  { row, active, cursor, onSelect }: {
    row: Row;
    active: boolean;
    cursor: boolean;
    onSelect: () => void;
  },
) {
  const { node, depth, open } = row;
  const isDir = node.kind === "dir";
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isDir ? open : undefined}
      aria-selected={active}
      className={`tree-row ${active ? "active" : ""} ${cursor ? "cursor" : ""}`}
      // Die Einrückung als Variable statt als Klasse: Die Tiefe ist eine Zahl,
      // und zwölf Klassen für zwölf Ebenen wären zwölfmal dasselbe.
      style={{ "--depth": depth } as CSSProperties}
      title={node.path}
      onClick={onSelect}
    >
      <span className="tree-twist">
        {isDir && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </span>
      {isDir
        ? (open ? <FolderOpen size={14} className="tree-icon" /> : <Folder size={14} className="tree-icon" />)
        : <FileText size={14} className="tree-icon" />}
      <span className="tree-name">{node.name}</span>
    </button>
  );
}

// ── Baum-Arbeit ─────────────────────────────────────────────────────────────

/**
 * Filtern mit Elternerhalt: Ein Ordner bleibt, wenn sein Name passt (dann
 * vollständig, mit allem darunter) oder wenn irgendetwas darunter passt.
 */
function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
  if (!term) return nodes;
  const result: TreeNode[] = [];
  for (const node of nodes) {
    const hit = node.name.toLowerCase().includes(term) || node.rel.toLowerCase().includes(term);
    if (node.kind === "file") {
      if (hit) result.push(node);
      continue;
    }
    if (hit) {
      result.push(node);
      continue;
    }
    const children = filterTree(node.children ?? [], term);
    if (children.length > 0) result.push({ ...node, children });
  }
  return result;
}

/** Verschachtelung → sichtbare Zeilen, in genau der Reihenfolge der Anzeige. */
function flatten(nodes: TreeNode[], isOpen: (node: TreeNode) => boolean, depth = 0): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    const open = node.kind === "dir" && isOpen(node);
    rows.push({ node, depth, open });
    if (open) rows.push(...flatten(node.children ?? [], isOpen, depth + 1));
  }
  return rows;
}
