// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { bestTranscript, classifySpeechError, loadSpeechLocaleId, recognitionLang, saveSpeechLocaleId, SPEECH_LOCALES } from './speech';

describe('speech error taxonomy', () => {
  it('maps every engine error into a message the UI knows', () => {
    expect(classifySpeechError('not-allowed')).toBe('mic-blocked');
    expect(classifySpeechError('service-not-allowed')).toBe('mic-blocked');
    expect(classifySpeechError('audio-capture')).toBe('mic-blocked');
    expect(classifySpeechError('network')).toBe('network');
    expect(classifySpeechError('no-speech')).toBe('no-speech');
    expect(classifySpeechError('aborted')).toBe('unknown');
    expect(classifySpeechError(undefined)).toBe('unknown');
    expect(classifySpeechError('some-future-error')).toBe('unknown');
  });

  it('is case and spelling tolerant', () => {
    expect(classifySpeechError('Not-Allowed')).toBe('mic-blocked');
    expect(classifySpeechError('NETWORK')).toBe('network');
  });
});

describe('accent-aware listening', () => {
  beforeEach(() => localStorage.clear());

  it('offers several English accents plus Persian and an auto choice', () => {
    const ids = SPEECH_LOCALES.map((locale) => locale.id);
    expect(ids).toContain('auto');
    expect(ids).toContain('en-IN');
    expect(ids).toContain('fa-IR');
    for (const locale of SPEECH_LOCALES) expect(locale.label.length).toBeGreaterThan(0);
  });

  it('persists the chosen accent and falls back to auto', () => {
    expect(loadSpeechLocaleId()).toBe('auto');
    saveSpeechLocaleId('en-IN');
    expect(loadSpeechLocaleId()).toBe('en-IN');
    saveSpeechLocaleId('not-a-locale');
    expect(loadSpeechLocaleId()).toBe('auto');
  });

  it('uses the chosen accent for recognition', () => {
    saveSpeechLocaleId('en-GB');
    expect(recognitionLang()).toBe('en-GB');
    saveSpeechLocaleId('auto');
    // In tests the app language is English, so auto resolves to en-US.
    expect(recognitionLang()).toBe('en-US');
  });

  it('keeps the most confident transcript alternative', () => {
    const result = {
      isFinal: true,
      length: 3,
      0: { transcript: 'plan for to', confidence: 0.4 },
      1: { transcript: 'plan for two', confidence: 0.9 },
      2: { transcript: 'plan four two', confidence: 0.6 },
    };
    expect(bestTranscript(result as never)).toBe('plan for two');
  });

  it('falls back to the first alternative without confidence data', () => {
    const bare = { isFinal: true, 0: { transcript: 'hello there' } };
    expect(bestTranscript(bare as never)).toBe('hello there');
  });
});
