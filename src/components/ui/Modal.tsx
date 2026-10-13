/* Dialog shell: backdrop, titled header with a close button, and a footer for the actions.
   Escape closes; the caller owns everything in between. */
import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  /** Stable id so the dialog can be labelled by its heading. */
  titleId?: string;
  onClose: () => void;
  actions: ReactNode;
  children: ReactNode;
}

export default function Modal({ title, titleId = "modalTitle", onClose, actions, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="iconbtn" aria-label="Cancel" onClick={onClose}>×</button>
        </header>
        {children}
        <footer className="modal-actions">{actions}</footer>
      </div>
    </div>
  );
}
