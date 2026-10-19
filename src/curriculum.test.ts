// @vitest-environment node
/**
 * The built-in lesson lists are data worth guarding: a subject lost in an
 * edit is a week a guardian has to type by hand, with no error anywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRICULUM_FIELDS,
  CURRICULUM_GRADES,
  curriculumGradeLabel,
  curriculumLessons,
  curriculumSuggestions,
  isCurriculumGrade,
  isCurriculumLesson,
  konkurLessons,
  matchCurriculumField,
} from './curriculum';
import { gradeLabel } from './panels';

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

describe('the entrance-exam year (کنکور)', () => {
  it('is a grade the picker offers, alongside the years of school', () => {
    expect(CURRICULUM_GRADES).toEqual(['school-10', 'school-11', 'school-12', 'konkur']);
    expect(isCurriculumGrade('konkur')).toBe(true);
    expect(curriculumGradeLabel('konkur')).toBeTruthy();
    // The years of school keep the labels the app already had for them.
    for (const grade of ['school-10', 'school-11', 'school-12'] as const) {
      expect(curriculumGradeLabel(grade)).toBe(gradeLabel(grade));
    }
  });

  it('holds the twelfth year whole, for every field', () => {
    for (const field of CURRICULUM_FIELDS) {
      const lessons = curriculumLessons(field.id, 'konkur');
      expect(lessons).not.toBeNull();
      // General lessons: exactly the twelfth year's, and nothing else.
      expect(lessons!.general).toEqual(field.lessons['school-12'].general);
      // And the twelfth year's own lessons lead the list.
      for (const name of field.lessons['school-12'].specialized) {
        expect(lessons!.specialized).toContain(name);
      }
    }
  });

  it('adds the field’s own lessons from the tenth and eleventh, and only those', () => {
    for (const field of CURRICULUM_FIELDS) {
      const lessons = curriculumLessons(field.id, 'konkur')!;
      const fromSchool = [
        ...field.lessons['school-10'].specialized,
        ...field.lessons['school-11'].specialized,
      ];
      for (const name of fromSchool) expect(lessons.specialized).toContain(name);
      // Nothing general from the earlier years sneaks in: the exam year is the
      // twelfth year plus the field's own subjects, not three years of school.
      for (const name of [...field.lessons['school-10'].general, ...field.lessons['school-11'].general]) {
        if (!field.lessons['school-12'].general.includes(name)) {
          expect(lessons.general).not.toContain(name);
        }
      }
      // And no lesson is listed twice, however many years taught it.
      expect(new Set(lessons.specialized).size).toBe(lessons.specialized.length);
      expect(new Set([...lessons.specialized, ...lessons.general]).size).toBe(
        lessons.specialized.length + lessons.general.length,
      );
    }
  });

  it('reads the exam year in the order a revision plan works: newest first', () => {
    const math = curriculumLessons('math', 'konkur')!;
    const at = (name: string) => math.specialized.indexOf(name);
    expect(at('حسابان (۲)')).toBeLessThan(at('حسابان (۱)'));
    expect(at('حسابان (۱)')).toBeLessThan(at('ریاضی (۱)'));
    // The twelfth year's geometry is not the tenth year's, and both are there.
    expect(math.specialized).toContain('هندسه (۳)');
    expect(math.specialized).toContain('هندسه (۱)');
  });

  it('taps in like any other grade', () => {
    const science = curriculumSuggestions('science', 'konkur');
    expect(science).toContain('زیست‌شناسی (۳)');
    expect(science).toContain('زیست‌شناسی (۲)');
    expect(science).toContain('زیست‌شناسی (۱)');
    expect(science).toContain('فارسی (۳)');
    // Specialized lessons come first, the way the picker reads.
    expect(science.indexOf('زیست‌شناسی (۳)')).toBeLessThan(science.indexOf('فارسی (۳)'));
    expect(isCurriculumLesson('زیست‌شناسی (۱)', 'science', 'konkur')).toBe(true);
    // A lesson from another field's tenth year is still not this field's.
    expect(isCurriculumLesson('منطق', 'science', 'konkur')).toBe(false);
    expect(curriculumLessons(null, 'konkur')).toBeNull();
    expect(curriculumLessons('science', 'konkuri')).toBeNull();
  });

  it('follows the years of school when they change', () => {
    // Built from the field's data rather than copied, so a subject added to a
    // year shows up in the exam year without anyone remembering to add it twice.
    const field = {
      id: 'math' as const,
      nameFa: 'رشته ریاضی و فیزیک',
      nameEn: 'Mathematics & Physics',
      lessons: {
        'school-10': { general: ['g10'], specialized: ['s10'] },
        'school-11': { general: ['g11'], specialized: ['s11'] },
        'school-12': { general: ['g12'], specialized: ['s12'] },
      },
    };
    expect(konkurLessons(field)).toEqual({
      general: ['g12'],
      specialized: ['s12', 's11', 's10'],
    });
  });
});
