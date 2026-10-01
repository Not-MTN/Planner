import { describe, expect, it } from 'vitest';
import {
  isRetryableStatus,
  modelEnvName,
  normalizeApiKey,
  PROVIDERS,
  resolveProviders,
  visionModelEnvName,
} from './aiProviders';

/**
 * One provider means one outage takes out every AI feature. These tests pin the
 * behaviour that prevents that: keys are additive, order is explicit, and a
 * provider that cannot do the job is skipped rather than asked and refused.
 */

const GROQ_KEY = 'gsk_test_key_1234567890';

describe('resolveProviders', () => {
  it('returns nothing when no provider is configured', () => {
    expect(resolveProviders({})).toEqual([]);
    expect(resolveProviders({ GROQ_API_KEY: '   ' })).toEqual([]);
  });

  it('defaults to Groq when only GROQ_API_KEY is set', () => {
    const providers = resolveProviders({ GROQ_API_KEY: GROQ_KEY });
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('groq');
    expect(providers[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(providers[0].key).toBe(GROQ_KEY);
    expect(providers[0].visionModel).toBeTruthy();
  });

  it('adds a second provider as a fallback, with no code change', () => {
    // This is the whole point: set one more variable, survive one more outage.
    const providers = resolveProviders({ GROQ_API_KEY: GROQ_KEY, OPENAI_API_KEY: 'sk-test' });
    expect(providers.map((item) => item.id)).toEqual(['groq', 'openai']);
  });

  it('follows AI_PROVIDERS when the operator names an order', () => {
    const providers = resolveProviders({
      GROQ_API_KEY: GROQ_KEY,
      OPENAI_API_KEY: 'sk-test',
      MISTRAL_API_KEY: 'mistral-key',
      AI_PROVIDERS: 'openai,groq',
    });
    expect(providers.map((item) => item.id)).toEqual(['openai', 'groq', 'mistral']);
  });

  it('ignores a provider named in AI_PROVIDERS but not configured', () => {
    const providers = resolveProviders({ GROQ_API_KEY: GROQ_KEY, AI_PROVIDERS: 'openai,groq' });
    expect(providers.map((item) => item.id)).toEqual(['groq']);
  });

  it('honours a per-provider model override, including switching images off', () => {
    const [provider] = resolveProviders({ GROQ_API_KEY: GROQ_KEY, GROQ_MODEL: 'llama-3.3-70b-versatile', GROQ_VISION_MODEL: '' });
    expect(provider.textModel).toBe('llama-3.3-70b-versatile');
    expect(provider.visionModel).toBe('');
  });

  it('keeps the default vision model when the override is unset', () => {
    const [provider] = resolveProviders({ GROQ_API_KEY: GROQ_KEY, GROQ_MODEL: 'llama-3.3-70b-versatile' });
    expect(provider.visionModel).toBe('qwen/qwen3.8-27b');
  });

  it('takes a custom OpenAI-compatible endpoint from AI_BASE_URL', () => {
    const providers = resolveProviders({ AI_BASE_URL: 'https://ai.internal.example/v1/', AI_API_KEY: 'k', AI_MODEL: 'my-model' });
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('custom');
    // Trailing slash and a doubled /chat/completions must not reach the wire.
    expect(providers[0].url).toBe('https://ai.internal.example/v1/chat/completions');
    expect(providers[0].textModel).toBe('my-model');
  });

  it('leaves a local Ollama out unless the operator asks for it', () => {
    expect(resolveProviders({ GROQ_API_KEY: GROQ_KEY }).map((item) => item.id)).not.toContain('ollama');
    const providers = resolveProviders({ OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1' });
    expect(providers.map((item) => item.id)).toEqual(['ollama']);
    // No key: the Authorization header is omitted entirely.
    expect(providers[0].key).toBe('');
  });

  it('never leaks a key into anything the browser could read', () => {
    const providers = resolveProviders({ GROQ_API_KEY: GROQ_KEY, OPENAI_API_KEY: 'sk-test' });
    expect(JSON.stringify(providers.map(({ id, label }) => ({ id, label })))).not.toContain(GROQ_KEY);
    expect(providers.every((item) => typeof item.key === 'string')).toBe(true);
  });

  it('keeps every provider id unique, so AI_PROVIDERS cannot be ambiguous', () => {
    const ids = PROVIDERS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeApiKey', () => {
  it('cleans up the ways a key usually arrives from a paste', () => {
    expect(normalizeApiKey('  "abc123"  ')).toBe('abc123');
    expect(normalizeApiKey("'abc123'")).toBe('abc123');
    expect(normalizeApiKey('Bearer abc123')).toBe('abc123');
    expect(normalizeApiKey('abc​123')).toBe('abc123');
    expect(normalizeApiKey(undefined)).toBe('');
  });
});

describe('isRetryableStatus', () => {
  it('moves on from a provider that is unhealthy, broke, or throttling', () => {
    for (const status of [401, 403, 404, 408, 429, 500, 502, 503]) expect(isRetryableStatus(status)).toBe(true);
  });

  it('does not move on from a request every provider would refuse anyway', () => {
    for (const status of [200, 400, 413, 422]) expect(isRetryableStatus(status)).toBe(false);
  });
});

describe('error message variables', () => {
  it('names the variable the operator has to change', () => {
    expect(modelEnvName('groq')).toBe('GROQ_MODEL');
    expect(visionModelEnvName('groq')).toBe('GROQ_VISION_MODEL');
    expect(modelEnvName('openai')).toBe('OPENAI_MODEL');
    expect(modelEnvName('custom')).toBe('AI_MODEL');
  });
});
