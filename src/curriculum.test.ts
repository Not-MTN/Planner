// @vitest-environment node
/**
 * The built-in lesson lists are data worth guarding: a subject lost in an
 * edit is a week a guardian has to type by hand, with no error anywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRICULUM_FIELDS,
  curriculumLessons,
  curriculumSuggestions,
  isCurriculumLesson,
  matchCurriculumField,
} from './curriculum';

describe('the national curriculum lists', () => {
  it('covers three fields and grades ten to twelve', () => {
    expect(CURRICULUM_FIELDS.map((field) => field.id)).toEqual(['math', 'science', 'humanities']);
    for (const field of CURRICULUM_FIELDS) {
      expect(Object.keys(field.lessons).sort()).toEqual(['school-10', 'school-11', 'school-12']);
      for (const lessons of Object.values(field.lessons)) {
        expect(lessons.general.length).toBeGreaterThan(0);
        expect(lessons.specialized.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every subject it was given', () => {
    // Grade-by-grade counts: general + specialized. If the curriculum itself
    // changes, these change deliberately, here, in one place.
    const counts: Record<string, Record<string, [number, number]>> = {
      math: { 'school-10': [10, 4], 'school-11': [10, 5], 'school-12': [8, 5] },
      science: { 'school-10': [10, 4], 'school-11': [9, 5], 'school-12': [8, 4] },
      humanities: { 'school-10': [8, 8], 'school-11': [6, 8], 'school-12': [7, 7] },
    };
    for (const field of CURRICULUM_FIELDS) {
      for (const [grade, lessons] of Object.entries(field.lessons)) {
        const [general, specialized] = counts[field.id]?.[grade] ?? [0, 0];
        expect(lessons.general, `${field.id} ${grade} general`).toHaveLength(general);
        expect(lessons.specialized, `${field.id} ${grade} specialized`).toHaveLength(specialized);
      }
    }
  });

  it('has no blank or repeated lesson in any list', () => {
    for (const field of CURRICULUM_FIELDS) {
      for (const [grade, lessons] of Object.entries(field.lessons)) {
        const all = [...lessons.general, ...lessons.specialized];
        expect(all.every((name) => name.trim().length > 0)).toBe(true);
        expect(new Set(all).size, `${field.id} ${grade} repeats`).toBe(all.length);
      }
    }
  });

  it('suggests specialized lessons before general ones', () => {
    const suggestions = curriculumSuggestions('math', 'school-11');
    expect(suggestions.slice(0, 5)).toEqual(['حسابان (۱)', 'هندسه (۲)', 'آمار و احتمال', 'فیزیک (۲)', 'شیمی (۲)']);
    expect(suggestions).toContain('فارسی (۲)');
  });

  it('offers nothing outside grades ten to twelve', () => {
    expect(curriculumLessons('math', 'school-9')).toBeNull();
    expect(curriculumLessons('math', 'university')).toBeNull();
    expect(curriculumLessons('math', null)).toBeNull();
    expect(curriculumLessons(null, 'school-11')).toBeNull();
    expect(curriculumSuggestions('science', 'other')).toEqual([]);
  });

  it('recognizes its own lessons, exactly', () => {
    expect(isCurriculumLesson('فیزیک (۲)', 'math', 'school-11')).toBe(true);
    expect(isCurriculumLesson('  فیزیک (۲)  ', 'math', 'school-11')).toBe(true);
    expect(isCurriculumLesson('فیزیک (۲)', 'math', 'school-10')).toBe(false);
    expect(isCurriculumLesson('Calligraphy club', 'math', 'school-11')).toBe(false);
  });
});

describe('matching a field of study to the curriculum', () => {
  it('reads Persian field names', () => {
    expect(matchCurriculumField('ریاضی و فیزیک')).toBe('math');
    expect(matchCurriculumField('علوم تجربی')).toBe('science');
    expect(matchCurriculumField('ادبیات و علوم انسانی')).toBe('humanities');
    expect(matchCurriculumField('دانش‌آموز رشته تجربی')).toBe('science');
  });

  it('reads English field names', () => {
    expect(matchCurriculumField('Mathematics')).toBe('math');
    expect(matchCurriculumField('high-school physics')).toBe('math');
    expect(matchCurriculumField('Biology')).toBe('science');
    expect(matchCurriculumField('Literature')).toBe('humanities');
  });

  it('lets specific markers win over shared ones', () => {
    // Chemistry is taught in every field; biology picks the science field.
    expect(matchCurriculumField('شیمی و زیست‌شناسی')).toBe('science');
    expect(matchCurriculumField('ریاضی')).toBe('math');
    expect(matchCurriculumField('شیمی')).toBeNull();
  });

  it('matches nothing when there is nothing to match', () => {
    expect(matchCurriculumField(null)).toBeNull();
    expect(matchCurriculumField('')).toBeNull();
    expect(matchCurriculumField('Carpentry')).toBeNull();
  });
});
