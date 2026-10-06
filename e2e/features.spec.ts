import { expect, test } from '@playwright/test';
import { bootOffline } from './support';

const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await bootOffline(page);
  await page.goto('/#/today');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('planner-tour-done', '1'); // specs here are not about the tour
  });
  await page.reload();
});

test('PWA quick-add shortcut drops the caret into quick add', async ({ page }) => {
  await page.goto('/#/today?qa=1');
  // Ten seconds, not five: the app retries the focus while the boot settles
  // (Shell.tsx), and this assertion should fail for a real reason rather than
  // for being impatient.
  try {
    await expect(page.locator('.quick-add input')).toBeFocused({ timeout: 10_000 });
  } catch (error) {
    // The next run should not have to guess. "inactive" alone does not say
    // whether the box was on screen, or what was holding the caret instead.
    const state = await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>('.quick-add input');
      const rect = box?.getBoundingClientRect();
      const active = document.activeElement as HTMLElement | null;
      return {
        hash: window.location.hash,
        boxPresent: Boolean(box),
        boxOnScreen: Boolean(rect && rect.width > 0 && rect.height > 0),
        active: active ? `${active.tagName.toLowerCase()}.${String(active.className || '')}`.slice(0, 80) : 'none',
        activeLabel: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim().slice(0, 40),
      };
    });
    throw new Error(`${(error as Error).message}\ncaret state: ${JSON.stringify(state)}`);
  }
});

test('the Today journal creates a journal note for the day', async ({ page }) => {
  // The journal lives behind a disclosure on Today ("Journal & notes"), closed
  // by default — the heading exists either way, so the first version of this
  // test found a hidden element and called it missing.
  await page.locator('details.day-notes-disclosure > summary').click();
  await expect(page.getByText('A few lines for this day')).toBeVisible();
  await page.locator('.journal-inline').fill('Met Bibi for coffee. Sun all day.');
  await page.locator('.journal-inline').blur();
  // `.journal-saved` specifically: "Saved" alone also matches the sidebar's
  // "Saved on this device".
  await expect(page.locator('.journal-saved')).toBeVisible();
  await page.reload();
  await expect(page.locator('.journal-inline')).toHaveValue('Met Bibi for coffee. Sun all day.');
  const kind = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').notes as Array<{ kind: string }>)[0]?.kind,
  );
  expect(kind).toBe('journal');
});

test('bulk select completes several tasks at once', async ({ page }) => {
  const quick = page.locator('.quick-add input');
  await quick.fill('Water the plants');
  await quick.press('Enter');
  await quick.fill('Fold the laundry');
  await quick.press('Enter');
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Water the plants' }).check();
  await page.getByRole('checkbox', { name: 'Select Fold the laundry' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  const done = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').tasks as Array<{ completed: boolean }>).filter((task) => task.completed).length,
  );
  expect(done).toBe(2);
});

test('[[note links]] create the linked note from the notes view', async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}');
    state.notes = [
      { id: 'seed-1', title: 'Trip ideas', body: 'Ask about [[Packing list]] first.', kind: 'quick', date: null, pinned: false, updatedAt: new Date().toISOString() },
    ];
    localStorage.setItem('personal-planner.v1', JSON.stringify(state));
  });
  await page.goto('/#/notes');
  await expect(page.locator('.note-link-pill', { hasText: 'Packing list' })).toBeVisible();
  // A missing note is created on the spot (with an Undo toast).
  await page.locator('.note-link-pill').click();
  await expect(page.getByText('created', { exact: false }).first()).toBeVisible();
  const titles = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').notes as Array<{ title: string }>).map((note) => note.title),
  );
  expect(titles).toContain('Packing list');
});

test('overdue tasks offer “This weekend” snooze', async ({ page }) => {
  await page.evaluate((iso) => {
    const state = JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}');
    state.tasks = [{ id: 'late-1', title: 'Fix the fence', completed: false, priority: 'medium', category: 'personal', dueDate: iso, order: 0, subtasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), repeat: null, dueTime: null, estimatedMinutes: null, source: null, important: false, notes: '', completedAt: null }];
    localStorage.setItem('personal-planner.v1', JSON.stringify(state));
  }, yesterday);
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: 'This weekend' }).first().click();
  const due = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').tasks as Array<{ dueDate: string }>)[0].dueDate,
  );
  expect(due > today || due === today).toBeTruthy();
  const day = new Date(`${due}T12:00:00`).getDay();
  expect([0, 6]).toContain(day);
});

test('settings show shared space, feeds, weather, import and templates', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  // Settings is tabbed and only the open group is mounted, so "is it in the
  // settings sheet" is not the question — "is it in the group it belongs to".
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Sync & backup' }).click();
  await expect(sheet.getByText('Shared space', { exact: true }).first()).toBeVisible();
  await sheet.getByRole('tab', { name: 'Connections' }).click();
  for (const label of ['Calendar feeds', 'Weather on Today', 'Move your tasks in', 'Templates']) {
    await expect(sheet.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await sheet.getByRole('tab', { name: 'Sync & backup' }).click();
  await sheet.getByRole('button', { name: 'Create a shared space' }).click();
  await expect(sheet.getByText('Shared space is on')).toBeVisible();
});

test('weather card appears when enabled, from a stubbed forecast', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Route stubbing check runs in Chromium');
  await page.route('**/api.open-meteo.com/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        current: { temperature_2m: 18, apparent_temperature: 17, weather_code: 2 },
        daily: { temperature_2m_max: [21], temperature_2m_min: [11] },
      }),
    });
  });
  await page.evaluate(() => {
    localStorage.setItem('planner-weather', JSON.stringify({ enabled: true, lat: 60.17, lon: 24.94, place: 'Helsinki' }));
  });
  await page.reload();
  await expect(page.locator('.weather-card')).toBeVisible();
  await expect(page.locator('.weather-card')).toContainText('18°');
  await expect(page.locator('.weather-card')).toContainText('Helsinki');
});

test('daily mood check-in saves and re-selects', async ({ page }) => {
  await expect(page.getByText('How did today feel?')).toBeVisible();
  await page.getByRole('button', { name: 'Log today as Glowing' }).click();
  await expect(page.getByText('Today felt glowing')).toBeVisible();
  const stored = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('personal-planner.v1') ?? '{}').moods as Array<{ value: number }>)[0]?.value,
  );
  expect(stored).toBe(5);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log today as Glowing' })).toHaveAttribute('aria-pressed', 'true');
});

test('any file — including music — can be attached to a note', async ({ page }) => {
  await page.goto('/#/notes');
  await page.getByRole('button', { name: 'Add note' }).first().click();
  // Several sheets are in the DOM at once and each composer form has a
  // `data-autofocus` field, so `getByRole('dialog').last()` plus one input was
  // ambiguous (five matches). The note editor is the sheet with the attachment
  // row the rest of this test uses.
  // All five composer forms are mounted inside the sheet and the four that are
  // not the open type are wrapped in `hidden`, so only one autofocus field is
  // on screen — the note's title.
  const dialog = page.locator('.sheet', { has: page.locator('.attach-editor') }).last();
  await dialog.locator('input[data-autofocus]:visible').first().fill('Studio');
  await dialog.locator('.attach-editor input[type="file"]').setInputFiles([
    { name: 'melody.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3' + '0'.repeat(2048)) },
    { name: 'score.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4' + 'x'.repeat(100)) },
  ]);
  await expect(dialog.locator('.attach-chip')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Add note' }).click();
  const card = page.locator('.note-card', { hasText: 'Studio' });
  await expect(card).toBeVisible();
  // Both survive the collapse: the audio player carries its own chip and the
  // PDF one of its own. (The old expectation of one predates the audio
  // attachment growing a chip of its own — AttachmentList renders every non-
  // image file.)
  await expect(card.locator('.attach-chip')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.note-card', { hasText: 'Studio' })).toContainText('Studio');
  const audio = page.locator('.note-card audio');
  await expect(audio).toBeVisible();
  const src = await audio.getAttribute('src');
  expect(src?.startsWith('blob:') || src === null || src === '').toBeTruthy();
});

test('voice dictation button appears on the AI plan request where supported', async ({ page }) => {
  // Chromium ships the Web Speech API; stub a fresh page anyway to stay deterministic.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      interimResults = true;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        window.setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'yoga at 7 in the morning' } }] });
          this.onend?.();
        }, 30);
      }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
  await page.goto('/#/ai');
  await expect(page.locator('.ai-prompt-field')).toBeVisible({ timeout: 10000 });
  const textarea = page.locator('.ai-prompt-field textarea');
  await textarea.fill('Keep it light.');
  await page.locator('.voice-mic').click();
  await expect(textarea).toHaveValue('Keep it light. yoga at 7 in the morning');
});
