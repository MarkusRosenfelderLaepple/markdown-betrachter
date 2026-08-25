import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function ProgressBar(
  { value, total, tone = "brand", thin }: {
    value: number;
    total: number;
    tone?: "brand" | "green" | "accent" | "violet";
    thin?: boolean;
  },
) {
  const ratio = total <= 0 ? 0 : Math.min(1, value / total);
  return (
    <div
      className={`progress ${tone} ${thin ? "thin" : ""}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={Math.max(total, value)}
    >
      <i style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function ProgressRing(
  { value, total, size = 108, label, sublabel, tone = "var(--brand)" }: {
    value: number;
    total: number;
    size?: number;
    label?: string;
    sublabel?: string;
    tone?: string;
  },
) {
  const ratio = total <= 0 ? 0 : Math.min(1, value / total);
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--panel-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          style={{ transition: "stroke-dasharray 420ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeContent: "center",
          textAlign: "center",
        }}
      >
        <strong style={{ fontSize: 22, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
          {label ?? `${Math.round(ratio * 100)}%`}
        </strong>
        {sublabel && <span className="tiny muted">{sublabel}</span>}
      </div>
    </div>
  );
}

export function Card(
  { title, icon, actions, children, className = "" }: {
    title?: string;
    icon?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
  },
) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {icon}
          {title && <h2>{title}</h2>}
          {actions && <div className="spacer">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Dialog auf Basis von **Radix**.
 *
 * Warum eine Abhängigkeit im „kein UI-Framework"-Projekt: Radix liefert
 * *Verhalten*, kein Aussehen — Fokus-Falle, Fokus-Rückgabe beim Schließen,
 * `aria-modal` samt Zurückstellen des Hintergrunds, Escape, Portal, Scroll-
 * Sperre. Die selbstgebaute Vorgängerversion hatte nichts davon: Tab führte
 * aus dem Dialog heraus in die Seite dahinter, und Screenreader lasen den
 * Hintergrund weiter vor.
 *
 * Das Aussehen bleibt vollständig beim eigenen Token-System: dieselben
 * Klassen `.overlay`, `.modal`, `.modal-head` wie zuvor.
 */
export function Modal(
  { title, icon, onClose, children, footer, description }: {
    title: string;
    icon?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    description?: string;
  },
) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {
          /* Content liegt im Overlay: Damit gilt das vorhandene Grid-Layout
            aus styles.css unverändert weiter. */
        }
        <Dialog.Overlay className="overlay">
          {
            /* Ohne Beschreibungstext `aria-describedby` ausdrücklich abschalten,
              sonst warnt Radix zur Laufzeit über die fehlende Dialog.Description.
              Mit Text setzt Radix die Verknüpfung selbst. */
          }
          <Dialog.Content className="modal" {...(description ? {} : { "aria-describedby": undefined })}>
            <header className="modal-head">
              {icon}
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="btn ghost icon"
                  style={{ marginLeft: "auto" }}
                  title="Schließen"
                  aria-label="Schließen"
                >
                  <X size={15} />
                </button>
              </Dialog.Close>
            </header>
            <div className="modal-body">
              {description && <Dialog.Description className="tiny muted">{description}</Dialog.Description>}
              {children}
            </div>
            {footer && <footer className="modal-foot">{footer}</footer>}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Rückfrage vor einer nicht umkehrbaren Aktion. Bewusst ein eigener Baustein:
 * `confirm()` blockiert im Webview den Prozess und sieht auf jeder Plattform
 * anders aus, und ein selbstgebauter Dialog ohne Fokus-Falle ist mit der
 * Tastatur nicht bedienbar.
 */
export function ConfirmDialog(
  { title, message, confirmLabel = "Löschen", danger = true, onConfirm, onClose }: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onClose: () => void;
  },
) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Abbrechen</button>
          <button
            type="button"
            className={`btn ${danger ? "danger" : "primary"}`}
            // Radix gibt den Fokus beim Schließen an das auslösende Element
            // zurück — deshalb erst schließen, dann handeln.
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function Segmented<T extends string | number>(
  { value, options, onChange }: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
  },
) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="empty">
      {icon}
      {children}
    </p>
  );
}
