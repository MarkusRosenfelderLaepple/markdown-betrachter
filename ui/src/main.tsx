import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query.ts";
import { App } from "./App.tsx";
import { startMenuBridge } from "./menu.ts";
import "./styles.css";
import "katex/dist/katex.min.css";

// Hört auf die CustomEvents, die `src/window.ts` aus dem nativen Menü
// hereinschickt. Im Browser-Entwicklungslauf passiert dabei schlicht nichts.
startMenuBridge();

const root = document.getElementById("root");
if (!root) throw new Error("#root fehlt");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
