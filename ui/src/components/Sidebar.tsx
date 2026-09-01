/**
 * Die linke Seitenleiste — ein Bereich, zwei Ansichten.
 *
 * Warum kein eigener vierter Streifen für den Ordnerbaum: Ein Fenster dieser
 * App muss sich auf 400 px ziehen lassen (DESIGN.md, Regel 8). Verlauf und
 * Baum sind außerdem dasselbe Bedürfnis — „welches Dokument als Nächstes" —
 * nur einmal nach Zeit und einmal nach Ort sortiert. Zwei Schalter für
 * dieselbe Frage wären einer zu viel.
 *
 * ⌘1 blendet weiterhin die ganze Leiste ein und aus, ⌘3 schaltet zwischen den
 * beiden Ansichten um.
 */
import { useStore } from "@tanstack/react-store";
import { ui, uiStore } from "../store/ui.ts";
import { Segmented } from "./atoms.tsx";
import { History } from "./History.tsx";
import { Tree } from "./Tree.tsx";

export function Sidebar({ canPick }: { canPick: boolean }) {
  const mode = useStore(uiStore, (state) => state.settings.sidebar);
  return (
    <aside className="side history">
      <div className="side-tabs">
        <Segmented
          value={mode}
          options={[{ value: "history", label: "Verlauf" }, { value: "tree", label: "Ordner" }]}
          onChange={(value) => ui.set("sidebar", value)}
        />
      </div>
      {mode === "tree" ? <Tree /> : <History canPick={canPick} />}
    </aside>
  );
}
