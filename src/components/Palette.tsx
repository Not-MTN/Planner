import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { todayISO } from '../dates';
import {
  ArcIcon,
  CalendarIcon,
  CheckIcon,
  DotsIcon,
  DownloadIcon,
  FlagIcon,
  MoonIcon,
  NoteIcon,
  PlusIcon,
  SearchIcon,
  StopwatchIcon,
  SunIcon,
  WeekIcon,
} from '../icons';
import { parseQuickAdd } from '../quickAdd';
import { searchHits, type SearchHit } from '../logic';
import { t } from '../i18n';

interface PaletteItem {
  id: string;
  icon: ComponentType<{ size?: number }>;
  label: string;
  sub?: string;
  chips?: string[];
  run: () => void;
}

const KIND_ICON = {
  task: CheckIcon,
  event: CalendarIcon,
  note: NoteIcon,
  goal: FlagIcon,
  habit: DotsIcon,
} as const;

export function Palette() {
  const planner = usePlanner();
  if (!planner.paletteOpen) return null;
  return <PaletteInner key="palette" />;
}

function PaletteInner() {
  const planner = usePlanner();
  const {
    state,
    navigate,
    closePalette,
    openComposer,
    addTask,
    addEvent,
    toggleTask,
    toggleHabit,
    flash,
    undo,
    canUndo,
    exportData,
    startFocus,
    themeMode,
    setThemeMode,
    isDark,
    openSettings,
  } = planner;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const today = todayISO();

  const items = useMemo<PaletteItem[]>(() => {
    const close = (run: () => void) => () => {
      run();
      closePalette();
    };
    const trimmed = query.trim();
    const list: PaletteItem[] = [];

    if (trimmed) {
      const parse = parseQuickAdd(trimmed, null);
      if (parse) {
        list.push({
          id: 'quick-add',
          icon: PlusIcon,
          label: t("Add {0}: “{1}”", { 0: parse.kind, 1: parse.title }),
          sub: parse.kind === 'event' ? t("Creates an event from what you typed") : t("Creates a task from what you typed"),
          chips: parse.chips,
          run: close(() => {
            if (parse.kind === 'event') {
              addEvent({
                title: parse.title,
                date: parse.date ?? today,
                startTime: parse.startTime ?? '12:00',
                endTime: parse.endTime,
                category: parse.category ?? 'personal',
                note: '',
                important: false,
              });
            } else {
              addTask({
                title: parse.title,
                priority: parse.priority ?? 'medium',
                dueDate: parse.date,
                dueTime: parse.startTime,
                category: parse.category ?? 'personal',
                note: '',
                goalId: null,
                repeat: parse.repeat,
              });
            }
            flash(t("{0} “{1}” added.", { 0: parse.kind === 'event' ? t("Event") : t("Task"), 1: parse.title }), { label: t("Undo"), run: undo });
          }),
        });
      }

      const hits = searchHits(state, trimmed, 4);
      for (const hit of hits) {
        list.push(hitItem(hit, close, planner));
      }
    } else {
      const creates: Array<[string, string]> = [
        ['task', t("New task")],
        ['event', t("New event")],
        ['habit', t("New habit")],
        ['goal', t("New goal")],
        ['note', t("New note")],
      ];
      for (const [type, label] of creates) {
        list.push({
          id: `create-${type}`,
          icon: PlusIcon,
          label,
          run: close(() => openComposer({ mode: 'create', type: type as 'task', date: today })),
        });
      }
    }

    const commands: PaletteItem[] = [
      { id: 'go-today', icon: SunIcon, label: t("Go to Today"), run: close(() => navigate({ name: 'today' })) },
      { id: 'go-calendar', icon: CalendarIcon, label: t("Go to Calendar"), sub: 'Week, month, and what’s ahead', run: close(() => navigate({ name: 'calendar', tab: 'week', date: today })) },
      { id: 'go-tasks', icon: CheckIcon, label: t("Go to Tasks"), run: close(() => navigate({ name: 'tasks' })) },
      { id: 'go-habits', icon: DotsIcon, label: t("Go to Habits"), run: close(() => navigate({ name: 'habits' })) },
      { id: 'go-goals', icon: FlagIcon, label: t("Go to Goals"), run: close(() => navigate({ name: 'goals' })) },
      { id: 'go-notes', icon: NoteIcon, label: t("Go to Notes"), run: close(() => navigate({ name: 'notes' })) },
      { id: 'go-insights', icon: ArcIcon, label: t("Go to Insights"), sub: 'Your week at a glance', run: close(() => navigate({ name: 'insights' })) },
      { id: 'focus', icon: StopwatchIcon, label: t("Start a focus session"), sub: 'A quiet timer for one thing', run: close(() => startFocus({ taskId: null, title: t("Focus session"), minutes: 25 })) },
      {
        id: 'theme',
        icon: isDark ? SunIcon : MoonIcon,
        label: isDark ? t("Switch to light mode") : t("Switch to dark mode"),
        sub: `Currently following ${themeMode === 'system' ? 'your system' : themeMode}`,
        run: close(() => setThemeMode(isDark ? 'light' : 'dark')),
      },
      { id: 'export', icon: DownloadIcon, label: t("Export backup"), run: close(() => exportData()) },
      { id: 'shortcuts', icon: SearchIcon, label: t("Open shortcuts"), sub: t("Keyboard cheat sheet"), run: close(() => openSettings()) },
    ];
    if (canUndo) {
      commands.push({ id: 'undo', icon: WeekIcon, label: t("Undo last change"), run: close(() => undo()) });
    }

    const needle = trimmed.toLowerCase();
    const matching = needle
      ? commands.filter((item) => `${item.label} ${item.sub ?? ''}`.toLowerCase().includes(needle))
      : commands;
    // When the query is exactly a destination or action ("insights", "dark"),
    // that command belongs above the quick-add row.
    const exact = needle ? matching.find((item) => matchesExactly(item.label, needle)) : undefined;
    if (exact) {
      const rest = matching.filter((item) => item !== exact);
      return [exact, ...list, ...rest].slice(0, 30);
    }
    return [...list, ...matching].slice(0, 30);
  }, [query, state, today, planner, closePalette, openComposer, navigate, addTask, addEvent, toggleTask, toggleHabit, flash, undo, canUndo, exportData, startFocus, setThemeMode, isDark, themeMode, openSettings]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLElement>('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePalette();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((current) => Math.min(current + 1, items.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[Math.min(index, items.length - 1)];
      if (item) item.run();
    }
  };

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("Search and quick add")}>
        <div className="palette-input-row">
          <SearchIcon size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
            placeholder={t("Search or add anything…")}
            aria-label={t("Search or add anything")}
            maxLength={200}
          />
          <kbd className="kbd">{t('esc')}</kbd>
        </div>
        {items.length === 0 ? (
          <p className="palette-empty">{t("Nothing found. Press Enter after typing to add it as a task.")}</p>
        ) : (
          <ul className="palette-list" ref={listRef} role="listbox" aria-label={t("Results")}>
            {items.map((item, itemIndex) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={itemIndex === index}
                    data-selected={itemIndex === index}
                    className={cx('palette-item', itemIndex === index && 'selected')}
                    onMouseEnter={() => setIndex(itemIndex)}
                    onClick={item.run}
                  >
                    <span className="palette-item-icon">
                      <Icon size={17} />
                    </span>
                    <span className="palette-item-body">
                      <span className="palette-item-label">{item.label}</span>
                      {item.sub ? <span className="palette-item-sub">{item.sub}</span> : null}
                    </span>
                    {item.chips?.length ? (
                      <span className="palette-item-chips">
                        {item.chips.slice(0, 4).map((chip) => (
                          <span key={chip} className="chip">
                            {chip}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <footer className="palette-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> {t('move')}</span>
          <span><kbd className="kbd">↵</kbd> {t('select')}</span>
          <span className="palette-foot-hint">{t("Smart add understands “tomorrow 5pm #work !high”")}</span>
        </footer>
      </div>
    </div>
  );
}

function matchesExactly(label: string, needle: string): boolean {
  const words = label
    .toLowerCase()
    .replace(/^go to\s+/, '')
    .replace(/^start a\s+/, '')
    .replace(/^switch to\s+/, '')
    .replace(/^new\s+/, '')
    .split(/\s+/);
  return words.includes(needle);
}

function hitItem(hit: SearchHit, close: (run: () => void) => () => void, planner: ReturnType<typeof usePlanner>): PaletteItem {
  const icon = KIND_ICON[hit.kind];
  const label = `${hit.kind}: “${hit.title}”`;
  if (hit.kind === 'task') {
    return {
      id: `task-${hit.id}`,
      icon,
      label,
      sub: `${hit.sub} — Enter toggles it`,
      run: close(() => {
        planner.toggleTask(hit.id);
        planner.flash(t("Task toggled."), { label: t("Undo"), run: planner.undo });
      }),
    };
  }
  if (hit.kind === 'event') {
    const event = planner.state.events.find((item) => item.id === hit.id);
    return {
      id: `event-${hit.id}`,
      icon,
      label,
      sub: hit.sub,
      run: close(() => planner.navigate({ name: 'day', date: event?.date ?? planner.route.name === 'today' ? todayISO() : todayISO() })),
    };
  }
  if (hit.kind === 'habit') {
    return {
      id: `habit-${hit.id}`,
      icon,
      label,
      sub: `${hit.sub} — Enter checks it off today`,
      run: close(() => {
        planner.toggleHabit(hit.id, todayISO());
        planner.flash(t("Habit toggled."), { label: t("Undo"), run: planner.undo });
      }),
    };
  }
  return {
    id: `${hit.kind}-${hit.id}`,
    icon,
    label,
    sub: hit.sub,
    run: close(() => planner.openComposer({ mode: 'edit', type: hit.kind, id: hit.id })),
  };
}
