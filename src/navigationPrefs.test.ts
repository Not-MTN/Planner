// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadNavigationPages, saveNavigationPages } from './navigationPrefs';

beforeEach(() => localStorage.clear());

describe('sidebar preferences', () => {
  it('defaults to every section', () => {
    expect(loadNavigationPages()).toContain('ai');
    expect(loadNavigationPages()).toContain('today');
  });

  it('persists selected sections and always keeps Today available', () => {
    saveNavigationPages(['tasks', 'calendar']);
    expect(loadNavigationPages()).toEqual(['today', 'tasks', 'calendar']);
  });

  it('ignores corrupt and unsupported stored values', () => {
    localStorage.setItem('planner-sidebar-pages', JSON.stringify(['tasks', 'secret-page', 7]));
    expect(loadNavigationPages()).toEqual(['today', 'tasks']);
    localStorage.setItem('planner-sidebar-pages', '{broken');
    expect(loadNavigationPages()).toContain('ai');
  });
});
