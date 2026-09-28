import { describe, expect, it } from 'vitest';
import { classifySpeechError } from './speech';

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
