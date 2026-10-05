import { expect, test } from '@playwright/test';
import { bootOffline } from './support';
test('voice chat: talk to the AI, get an answer, and a plan draft', async ({ page }) => {
  await bootOffline(page);
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''; interimResults = true; continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        window.setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'plan tomorrow gently, gym late afternoon' } }] });
          this.onend?.();
        }, 40);
      }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      getVoices: () => [{ lang: 'en-US', name: 'fake', default: true }],
      cancel: () => undefined,
      speak: (u: { onend?: (() => void) | null }) => u.onend?.(),
    };
  });
  await page.route('**/api/groq/status', (route) => route.fulfill({ status: 200, json: { configured: true } }));
  await page.route('**/api/groq/chat/completions', (route) => route.fulfill({
    status: 200,
    json: {
      choices: [{ message: { content: JSON.stringify({ reply: 'Soft tomorrow, one breath before the gym.', followUp: null, draft: { summary: 'Soft tomorrow', tasks: [{ title: 'Gym bag', date: new Date(Date.now() + 864e5).toISOString().slice(0, 10), priority: 'low', category: 'health' }], events: [], habits: [], suggestions: [] } }) } }],
    },
  }));
  await page.evaluate(() => localStorage.setItem('planner-tour-done', '1'));
  await page.goto('/#/ai');
  await expect(page.getByText('Talk to your planner')).toBeVisible({ timeout: 10000 });
  await page.locator('.voice-orb').click();
  await expect(page.locator('.voice-bubble.user')).toContainText('plan tomorrow gently');
  await expect(page.locator('.voice-bubble.assistant')).toContainText('Soft tomorrow');
  await expect(page.getByText('Soft tomorrow').last()).toBeVisible();
});
