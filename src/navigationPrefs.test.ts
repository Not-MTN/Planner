// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMobileFavorites, loadNavigationPages, MAX_MOBILE_FAVORITES, moveMobileFavorite, saveMobileFavorites, saveNavigationPages } from './navigationPrefs';

beforeEach(() => localStorage.clear());

describe('sidebar preferences', () => {
  it('defaults to every section, including the permanent Today and Review destinations', () => {
    expect(loadNavigationPages()).toContain('ai');
    expect(loadNavigationPages()).toContain('today');
    expect(loadNavigationPages()).toContain('review');
  });

  it('persists selected sections while keeping Today and Review available', () => {
    saveNavigationPages(['tasks', 'calendar']);
    expect(loadNavigationPages()).toEqual(['today', 'tasks', 'calendar', 'review']);
  });

  it('ignores corrupt and unsupported stored values', () => {
    localStorage.setItem('planner-sidebar-pages', JSON.stringify(['tasks', 'secret-page', 7]));
    expect(loadNavigationPages()).toEqual(['today', 'tasks', 'review']);
    localStorage.setItem('planner-sidebar-pages', '{broken');
    expect(loadNavigationPages()).toContain('ai');
  });
});

describe('mobile favorites', () => {
  it('starts empty so the existing More groups remain the default', () => {
    expect(loadMobileFavorites()).toEqual([]);
  });

  it('persists the selected pages in the chosen order, up to the limit', () => {
    const selected = ['ai', 'calendar', 'tasks', 'notes', 'goals'] as const;
    saveMobileFavorites([...selected]);
    expect(loadMobileFavorites()).toEqual(selected.slice(0, MAX_MOBILE_FAVORITES));
  });

  it('reorders a favorite one position at a time without adding or removing pages', () => {
    const favorites = ['ai', 'calendar', 'tasks'] as const;
    expect(moveMobileFavorite([...favorites], 'tasks', 'up')).toEqual(['ai', 'tasks', 'calendar']);
    expect(moveMobileFavorite(['ai', 'tasks', 'calendar'], 'tasks', 'down')).toEqual(['ai', 'calendar', 'tasks']);
    expect(moveMobileFavorite([...favorites], 'ai', 'up')).toEqual(favorites);
    expect(moveMobileFavorite([...favorites], 'tasks', 'down')).toEqual(favorites);
  });

  it('ignores invalid and duplicate stored pages', () => {
    localStorage.setItem('planner-mobile-favorites', JSON.stringify(['notes', 'secret-page', 'notes', 7, 'ai']));
    expect(loadMobileFavorites()).toEqual(['notes', 'ai']);
    localStorage.setItem('planner-mobile-favorites', '{broken');
    expect(loadMobileFavorites()).toEqual([]);
  });
});
