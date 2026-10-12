/**
 * The tab strip the optional panels are built from.
 *
 * A panel is a page of its own, and a page that tries to do everything at once
 * is how a panel gets abandoned: the guardian asking "how was this week?" and
 * the same guardian building next week's plan are two different questions, and
 * the student looking for the next thing to do is not reading charts. So each
 * panel is a small number of tabs — one job each — and this is the single place
 * that strip, its keyboard behaviour, and its accessibility wiring are written
 * down.
 *
 * Only the chosen tab is mounted. A tab that is not chosen is not rendered and
 * then hidden; it is simply not there, which is also what keeps each panel's
 * markup light on a phone.
 */
import { useRef, type ComponentType, type ReactNode } from 'react';
import { cx } from '../cx';

export interface PanelTab<T extends string> {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  /** A count worth noticing — unread notes, students waiting. */
  count?: number;
  /** A quiet mark for something new that has no number. */
  dot?: boolean;
}

export function PanelTabs<T extends string>({
  id,
  label,
  tabs,
  active,
  onChange,
  className,
}: {
  id: string;
  label: string;
  tabs: Array<PanelTab<T>>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const goTo = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.id);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    if (index < 0) return;
    // Direction is not swapped for RTL on purpose: the strip reads in the
    // document's own direction, and so do the arrows that walk it.
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      goTo((index + 1) % tabs.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      goTo((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(tabs.length - 1);
    }
  };

  return (
    <div className={cx('panel-tabs', className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-selected={on}
            aria-controls={`${id}-panel`}
            tabIndex={on ? 0 : -1}
            className={cx('panel-tab', on && 'on')}
            onClick={() => onChange(tab.id)}
          >
            {Icon ? <Icon size={16} /> : null}
            <span className="panel-tab-label">{tab.label}</span>
            {tab.count ? (
              <span className="panel-tab-count" aria-hidden="true">
                {tab.count > 9 ? '9+' : tab.count}
              </span>
            ) : null}
            {tab.dot && !tab.count ? <i className="panel-tab-dot" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The body of the tab that is open, wired to its strip by the same `id`. */
export function PanelTabPanel({ id, tab, children }: { id: string; tab: string; children: ReactNode }) {
  return (
    <div
      className="panel-tabpanel"
      id={`${id}-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${tab}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
