import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../cx';
import { CloseIcon, LeafIcon } from '../icons';
import { t } from '../i18n';

export function Modal({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Keep the latest onClose without re-running the focus/trap effect: parents
  // often pass inline callbacks, and re-focusing on every re-render is what
  // made sheets and pages jump to the top whenever state changed.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1 && !element.closest('[hidden]'),
      );
    const preferred = [...root.querySelectorAll<HTMLElement>('[data-autofocus]')].find((element) => !element.closest('[hidden]'));
    (preferred ?? focusable().find((element) => !element.closest('[hidden]')))?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // Put focus back where it came from — but never scroll for it, and never
      // into the closing sheet itself (its buttons are about to unmount).
      if (previous && document.contains(previous) && !root.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cx('sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="hint">{hint}</small> : null}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

export function Empty({
  title,
  text,
  action,
  image,
}: {
  title: string;
  text: string;
  action?: ReactNode;
  image?: string;
}) {
  return (
    <div className="empty">
      {image ? (
        <img className="spot" src={image} alt="" loading="lazy" />
      ) : (
        <span className="empty-mark" aria-hidden="true">
          <LeafIcon size={22} />
        </span>
      )}
      <p className="empty-title">{title}</p>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label?: string }) {
  const width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  return (
    <div
      className="meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={label}
    >
      <span style={{ width }} />
    </div>
  );
}

export function Ring({ value, label, caption }: { value: number; label: string; caption: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, value)));
  return (
    <div className="ring-wrap">
      <svg className="ring" viewBox="0 0 88 88" aria-hidden="true">
        <circle className="ring-track" cx="44" cy="44" r={radius} />
        <circle
          className="ring-value"
          cx="44"
          cy="44"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-copy">
        <strong>{label}</strong>
        <span>{caption}</span>
      </div>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="loading" aria-busy="true" aria-live="polite">
      <p className="kicker">{t("Personal Planner")}</p>
      <div className="sk sk-title" />
      <div className="sk-grid">
        <div className="sk sk-card" />
        <div className="sk sk-card short" />
      </div>
      <p className="visually-hidden">{t("Loading your planner")}</p>
    </div>
  );
}
