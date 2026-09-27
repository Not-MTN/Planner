import { usePlanner } from '../context';
import { cx } from '../cx';
import { frequencyLabelOf } from '../logic';
import { HABIT_GROUPS, presetToInput, type HabitPreset } from '../presets';
import { HabitGlyph } from '../icons';
import { Modal } from './ui';

export function HabitLibrary({ onClose }: { onClose: () => void }) {
  const { state, addHabit, addHabits, flash, undo } = usePlanner();
  const existing = new Set(state.habits.map((habit) => habit.name.toLowerCase()));

  const addPreset = (preset: HabitPreset) => {
    addHabit(presetToInput(preset));
    flash(`Habit “${preset.name}” added.`, { label: 'Undo', run: undo });
  };

  const addGroup = (presets: HabitPreset[]) => {
    const fresh = presets.filter((preset) => !existing.has(preset.name.toLowerCase()));
    if (fresh.length === 0) return;
    addHabits(fresh.map(presetToInput));
    flash(`${fresh.length} ${fresh.length === 1 ? 'habit' : 'habits'} added.`, { label: 'Undo', run: undo });
  };

  return (
    <Modal title="Habit library" onClose={onClose} className="sheet-library">
      <img className="library-banner" src="/img/spot-library.jpg" alt="" loading="lazy" />
      <p className="lede">Built-in habits and daily must-dos, one tap away. Add what fits; leave the rest.</p>
      {HABIT_GROUPS.map((group) => (
        <section key={group.id} className="library-group">
          <header className="library-group-head">
            <div>
              <h3>{group.label}</h3>
              <p className="meta">{group.blurb}</p>
            </div>
            <button
              type="button"
              className="btn btn-tiny btn-soft"
              onClick={() => addGroup(group.presets)}
            >
              Add all
            </button>
          </header>
          <ul className="library-list">
            {group.presets.map((preset) => {
              const added = existing.has(preset.name.toLowerCase());
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    className={cx('library-item', `accent-${preset.accent}`, added && 'is-added')}
                    disabled={added}
                    onClick={() => addPreset(preset)}
                  >
                    <span className={cx('icon-well', `accent-${preset.accent}`)}>
                      <HabitGlyph name={preset.icon} />
                    </span>
                    <span className="library-copy">
                      <strong>{preset.name}</strong>
                      <small>
                        {frequencyLabelOf(preset.frequency)}
                        {preset.essential ? ' · must-do' : ''}
                      </small>
                    </span>
                    {added ? <span className="chip">Added</span> : <span className="library-add">Add</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Modal>
  );
}
