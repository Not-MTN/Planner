/**
 * Built-in lessons for the guardian's week planner.
 *
 * Where a student studies under the Iranian national curriculum, the guardian
 * should not have to type every subject from memory: pick the field of study
 * and the grade, and the week's general and specialized lessons are there to
 * tap in. Anything else — another country, university, a custom program — is
 * planned by typing names freely, exactly as before.
 *
 * The names are curriculum proper nouns, so they stay in Persian in every
 * language (the same way a book title would). Only the field labels the
 * guardian picks from are translated, and those live beside the data so the
 * whole list reads in one place.
 */

export type CurriculumFieldId = 'math' | 'science' | 'humanities';

/** The grades the national curriculum covers: tenth, eleventh, twelfth. */
export type CurriculumGrade = 'school-10' | 'school-11' | 'school-12';

export interface CurriculumGradeLessons {
  /** Shared lessons every student of the grade takes. */
  general: string[];
  /** The field's own lessons. */
  specialized: string[];
}

export interface CurriculumField {
  id: CurriculumFieldId;
  /** Shown in the planner's field picker. Persian first: these are its names. */
  nameFa: string;
  nameEn: string;
  lessons: Record<CurriculumGrade, CurriculumGradeLessons>;
}

const GENERAL_MATH_10 = [
  'فارسی (۱)',
  'نگارش (۱)',
  'دین و زندگی (۱)',
  'عربی زبان قرآن (۱)',
  'زبان انگلیسی (۱)',
  'جغرافیای ایران',
  'آمادگی دفاعی',
  'تفکر و سواد رسانه‌ای / کارگاه کارآفرینی و تولید',
  'آزمایشگاه علوم تجربی (۱)',
  'تربیت بدنی (۱)',
];

const GENERAL_MATH_11 = [
  'فارسی (۲)',
  'نگارش (۲)',
  'دین و زندگی (۲)',
  'عربی زبان قرآن (۲)',
  'زبان انگلیسی (۲)',
  'تاریخ معاصر ایران',
  'انسان و محیط زیست',
  'آزمایشگاه علوم تجربی (۲)',
  'زمین‌شناسی',
  'تربیت بدنی (۲)',
];

const GENERAL_12 = [
  'فارسی (۳)',
  'نگارش (۳)',
  'دین و زندگی (۳)',
  'عربی زبان قرآن (۳)',
  'زبان انگلیسی (۳)',
  'سلامت و بهداشت',
  'مدیریت خانواده و سبک زندگی',
  'تربیت بدنی (۳)',
];

export const CURRICULUM_FIELDS: CurriculumField[] = [
  {
    id: 'math',
    nameFa: 'رشته ریاضی و فیزیک',
    nameEn: 'Mathematics & Physics',
    lessons: {
      'school-10': {
        general: GENERAL_MATH_10,
        specialized: ['ریاضی (۱)', 'فیزیک (۱)', 'شیمی (۱)', 'هندسه (۱)'],
      },
      'school-11': {
        general: GENERAL_MATH_11,
        specialized: ['حسابان (۱)', 'هندسه (۲)', 'آمار و احتمال', 'فیزیک (۲)', 'شیمی (۲)'],
      },
      'school-12': {
        general: GENERAL_12,
        specialized: ['حسابان (۲)', 'هندسه (۳)', 'ریاضیات گسسته', 'فیزیک (۳)', 'شیمی (۳)'],
      },
    },
  },
  {
    id: 'science',
    nameFa: 'رشته علوم تجربی',
    nameEn: 'Experimental Sciences',
    lessons: {
      'school-10': {
        general: GENERAL_MATH_10,
        specialized: ['ریاضی (۱)', 'زیست‌شناسی (۱)', 'فیزیک (۱)', 'شیمی (۱)'],
      },
      'school-11': {
        general: [
          'فارسی (۲)',
          'نگارش (۲)',
          'دین و زندگی (۲)',
          'عربی زبان قرآن (۲)',
          'زبان انگلیسی (۲)',
          'تاریخ معاصر ایران',
          'انسان و محیط زیست',
          'آزمایشگاه علوم تجربی (۲)',
          'تربیت بدنی (۲)',
        ],
        specialized: ['ریاضی (۲)', 'زیست‌شناسی (۲)', 'فیزیک (۲)', 'شیمی (۲)', 'زمین‌شناسی'],
      },
      'school-12': {
        general: GENERAL_12,
        specialized: ['ریاضی (۳)', 'زیست‌شناسی (۳)', 'فیزیک (۳)', 'شیمی (۳)'],
      },
    },
  },
  {
    id: 'humanities',
    nameFa: 'رشته ادبیات و علوم انسانی',
    nameEn: 'Literature & Humanities',
    lessons: {
      'school-10': {
        general: [
          'فارسی (۱)',
          'نگارش (۱)',
          'دین و زندگی (۱)',
          'زبان انگلیسی (۱)',
          'جغرافیای ایران',
          'آمادگی دفاعی',
          'تفکر و سواد رسانه‌ای / کارگاه کارآفرینی و تولید',
          'تربیت بدنی (۱)',
        ],
        specialized: [
          'ریاضی و آمار (۱)',
          'علوم و فنون ادبی (۱)',
          'عربی تخصصی زبان قرآن (۱)',
          'جامعه‌شناسی (۱)',
          'تاریخ (۱)',
          'جغرافیا (۱)',
          'اقتصاد',
          'منطق',
        ],
      },
      'school-11': {
        general: [
          'فارسی (۲)',
          'نگارش (۲)',
          'دین و زندگی (۲)',
          'زبان انگلیسی (۲)',
          'انسان و محیط زیست',
          'تربیت بدنی (۲)',
        ],
        specialized: [
          'ریاضی و آمار (۲)',
          'علوم و فنون ادبی (۲)',
          'عربی تخصصی زبان قرآن (۲)',
          'جامعه‌شناسی (۲)',
          'تاریخ (۲)',
          'جغرافیا (۲)',
          'فلسفه (۱)',
          'روان‌شناسی',
        ],
      },
      'school-12': {
        general: [
          'فارسی (۳)',
          'نگارش (۳)',
          'دین و زندگی (۳)',
          'زبان انگلیسی (۳)',
          'سلامت و بهداشت',
          'مدیریت خانواده و سبک زندگی',
          'تربیت بدنی (۳)',
        ],
        specialized: [
          'ریاضی و آمار (۳)',
          'علوم و فنون ادبی (۳)',
          'عربی تخصصی زبان قرآن (۳)',
          'جامعه‌شناسی (۳)',
          'تاریخ (۳)',
          'جغرافیا (۳)',
          'فلسفه (۲)',
        ],
      },
    },
  },
];

export function curriculumField(id: string | null | undefined): CurriculumField | null {
  if (!id) return null;
  return CURRICULUM_FIELDS.find((field) => field.id === id) ?? null;
}

/** Grades the built-in lessons cover. Display them with `gradeLabel` from panels.ts, which translates. */
export const CURRICULUM_GRADES: CurriculumGrade[] = ['school-10', 'school-11', 'school-12'];

export function isCurriculumGrade(grade: string | null | undefined): grade is CurriculumGrade {
  return (CURRICULUM_GRADES as readonly string[]).includes(grade ?? '');
}

/** The built-in lessons for a field and grade, or null when the grade is outside the curriculum. */
export function curriculumLessons(
  fieldId: string | null | undefined,
  grade: string | null | undefined,
): CurriculumGradeLessons | null {
  const field = curriculumField(fieldId);
  if (!field || !isCurriculumGrade(grade)) return null;
  return field.lessons[grade];
}

/** The one flat suggestion list the planner offers: specialized first, then general. */
export function curriculumSuggestions(
  fieldId: string | null | undefined,
  grade: string | null | undefined,
): string[] {
  const lessons = curriculumLessons(fieldId, grade);
  if (!lessons) return [];
  return [...lessons.specialized, ...lessons.general];
}

/** True when a lesson name came from the built-in list (so it can travel as a subject). */
export function isCurriculumLesson(
  name: string,
  fieldId: string | null | undefined,
  grade: string | null | undefined,
): boolean {
  const clean = name.trim();
  if (!clean) return false;
  return curriculumSuggestions(fieldId, grade).some((lesson) => lesson === clean);
}

/**
 * Guess the field from a few words — a student's "what do you study", or what
 * a guardian types. Specific markers win over shared ones: chemistry belongs
 * to every field, but biology belongs to one.
 */
export function matchCurriculumField(text: string | null | undefined): CurriculumFieldId | null {
  const clean = (text ?? '').trim().toLowerCase();
  if (!clean) return null;
  const has = (...needles: string[]) => needles.some((needle) => clean.includes(needle));
  if (has('تجربی', 'زیست', 'biology', 'experimental', 'science', 'علوم تجربی')) return 'science';
  if (has('انسانی', 'ادبیات', 'علوم انسانی', 'humanities', 'literature', 'philosophy', 'فلسفه', 'روان')) return 'humanities';
  if (has('ریاضی', 'فیزیک', 'حسابان', 'هندسه', 'math', 'physics', 'calculus', 'geometry')) return 'math';
  return null;
}
