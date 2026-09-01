/**
 * Der Arbeitsordner — das, was der Ordnerbaum in der Seitenleiste zeigt.
 *
 * Es gibt genau **einen**. Ein zweiter Ordner ersetzt den ersten, so wie ein
 * zweites Dokument das erste ersetzt: Der Betrachter zeigt eine Sache, und
 * mehrere Wurzeln nebeneinander wären ein Projektfenster, keine Leseansicht.
 *
 * Der Ordner selbst steht in den Einstellungen (`workspaceDir`) und überlebt
 * damit den Neustart; der eingelesene Baum ist Serverzustand und liegt in
 * React Query (`treeQuery`).
 */
import { errorMessage } from "../api.ts";
import { pickFolder, queryClient, treeQuery } from "../query.ts";
import { toast, ui, uiStore } from "./ui.ts";

export const workspace = {
  /** Nativer Ordner-Dialog (läuft auf der Deno-Seite, siehe `src/files.ts`). */
  async pick(): Promise<void> {
    try {
      const { tree } = await pickFolder();
      if (!tree) return; // Abbruch im Dialog ist kein Fehler.
      // Der Dialog hat den Baum bereits eingelesen — ihn in den Cache zu legen
      // spart den sofortigen zweiten Durchlauf durch dasselbe Verzeichnis.
      queryClient.setQueryData(treeQuery(tree.root).queryKey, tree);
      workspace.set(tree.root);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  },

  /** Ordner übernehmen und sichtbar machen — auch vom Startargument benutzt. */
  set(root: string): void {
    ui.set("workspaceDir", root);
    ui.set("sidebar", "tree");
    // Ein gewählter Ordner, den man nicht sieht, wäre eine stumme Aktion.
    if (!uiStore.state.settings.showHistory) ui.set("showHistory", true);
  },

  close(): void {
    ui.set("workspaceDir", "");
    ui.set("sidebar", "history");
  },
};
