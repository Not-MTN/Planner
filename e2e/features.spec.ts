import { expect, test } from '@playwright/test';

const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await page.goto('/#/today');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('PWA quick-add shortcut drops the caret into quick add', async ({ page }) => {
  await page.goto('/#/today?qa=1');
  await expect(page.locator('.quick-add input')).toBeFocused({ timeout: 5000 });
});

test('the Today journal creates a journal note for the day', async ({ page }) => {
  await expect(page.getByText('A few lines for this day')).toBeVisible();
  await page.locator('.journal-inline').fill('Met Bibi for coffee. Sun all day.');
  await page.locator('.journal-inline').blur();
  await expect(page.getByText('Saved')).toBeVisible();
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
  for (const label of ['Shared space', 'Calendar feeds', 'Weather on Today', 'Move your tasks in', 'Templates']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Create a shared space' }).click();
  await expect(page.getByText('Shared space is on')).toBeVisible();
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
