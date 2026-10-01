/**
 * Where an AI request goes.
 *
 * Every Planner AI feature — planning, refinement, review, the panels' advice
 * — funnels through one server-side proxy. Today that means one provider and
 * one API key, so a single outage, a rate limit, or an exhausted free allowance
 * takes out the whole AI surface at once: the button stops working and the user
 * has no way to know why.
 *
 * This module turns that one provider into a list. Each entry is an
 * OpenAI-compatible chat-completions endpoint, configured entirely by
 * environment variables; the proxy tries them in order and falls through to the
 * next when one is unreachable, rate-limiting, out of credit, or rejecting the
 * key. Nothing in the browser changes: it still names only the *role* it needs
 * (text or vision) and the server decides who answers.
 *
 * Adding a key is therefore additive, not a migration — set a second provider
 * and it becomes the fallback. Order them with `AI_PROVIDERS=openai,groq`.
 */

export interface ProviderSpec {
  id: string;
  /** Human-readable name, used in error messages the user actually reads. */
  label: string;
  /** OpenAI-compatible base URL; `/chat/completions` is appended. */
  baseUrl: string;
  /** The environment variable holding this provider's key. */
  keyEnv: string;
  /** Providers that need no key at all (a local Ollama). */
  keyless?: boolean;
  textModel: string;
  /** Empty string: this provider cannot read images. */
  visionModel: string;
  /** Models that accept `reasoning_effort`, mapped to the value to send. */
  reasoning?: Record<string, string>;
  /** Where to top up, named in the "out of credit" message. */
  billingUrl?: string;
  /** Key console, named in the "this key was rejected" message. */
  keyUrl?: string;
  /** Model list, named in the "no such model" message. */
  modelsUrl?: string;
  /** Only enabled when this variable is set — used for opt-in local endpoints. */
  requiresEnv?: string;
  /** Set when `requiresEnv` names the base URL rather than a flag. */
  baseUrlFromEnv?: boolean;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    textModel: 'openai/gpt-oss-120b',
    visionModel: 'qwen/qwen3.8-27b',
    // Reasoning tokens are billed against the answer's token budget, so an
    // unspecified effort lets the model spend the whole allowance thinking.
    reasoning: { 'openai/gpt-oss-120b': 'low', 'openai/gpt-oss-20b': 'low', 'qwen/qwen3.8-27b': 'none' },
    billingUrl: 'https://console.groq.com/settings/billing',
    keyUrl: 'https://console.groq.com',
    modelsUrl: 'https://console.groq.com/docs/models',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    textModel: 'llama3.1-70b',
    visionModel: '',
    billingUrl: 'https://cloud.cerebras.ai',
    keyUrl: 'https://cloud.cerebras.ai',
    modelsUrl: 'https://inference-docs.cerebras.ai/models',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    textModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
    keyUrl: 'https://platform.openai.com/api-keys',
    modelsUrl: 'https://platform.openai.com/docs/models',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    textModel: 'mistral-small-latest',
    visionModel: 'pixtral-12b-2409',
    billingUrl: 'https://console.mistral.ai/billing',
    keyUrl: 'https://console.mistral.ai/api-keys',
    modelsUrl: 'https://docs.mistral.ai/getting-started/models/',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    keyEnv: 'TOGETHER_API_KEY',
    textModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    visionModel: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
    billingUrl: 'https://api.together.ai/settings/billing',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    modelsUrl: 'https://docs.together.ai/docs/inference-models',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    textModel: 'openai/gpt-oss-120b',
    visionModel: 'qwen/qwen3-vl-32b-instruct',
    billingUrl: 'https://openrouter.ai/settings/credits',
    keyUrl: 'https://openrouter.ai/keys',
    modelsUrl: 'https://openrouter.ai/models',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    // Local by nature, so it is opt-in: without OLLAMA_BASE_URL the proxy must
    // never spend a request trying to reach 127.0.0.1 on a hosted deployment.
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: 'OLLAMA_API_KEY',
    keyless: true,
    textModel: 'llama3.1',
    visionModel: 'llava',
    requiresEnv: 'OLLAMA_BASE_URL',
    baseUrlFromEnv: true,
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    baseUrl: '',
    keyEnv: 'AI_API_KEY',
    keyless: true,
    textModel: '',
    visionModel: '',
    requiresEnv: 'AI_BASE_URL',
    baseUrlFromEnv: true,
  },
];

/** A provider with its key and models resolved for this deployment. */
export interface ResolvedProvider {
  id: string;
  label: string;
  /** Full chat-completions URL. */
  url: string;
  /** Empty for keyless providers; the Authorization header is then omitted. */
  key: string;
  textModel: string;
  visionModel: string;
  reasoning: Record<string, string>;
  billingUrl?: string;
  keyUrl?: string;
  modelsUrl?: string;
  /** The variable the operator needs to fix when this provider's key is bad. */
  keyEnv: string;
}

/** Trim a value the way a pasted secret usually needs trimming. */
export function normalizeApiKey(value: string | undefined): string {
  if (!value) return '';
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim();
  return key.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  // Accept both a bare origin and an OpenAI-style base path: the proxy appends
  // /chat/completions, so anything already ending in it is trimmed back first.
  const withoutEndpoint = trimmed.replace(/\/chat\/completions$/, '');
  return withoutEndpoint.replace(/\/v\d+$/, (match) => match);
}

function chatUrl(base: string): string {
  const normalized = normalizeBaseUrl(base);
  if (!normalized) return '';
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

/** The variable an operator sets to change this provider's text model. */
export function modelEnvName(id: string): string {
  return `${id === 'custom' ? 'AI' : id.toUpperCase()}_MODEL`;
}

/** The variable an operator sets to change — or blank out — its vision model. */
export function visionModelEnvName(id: string): string {
  return `${id === 'custom' ? 'AI' : id.toUpperCase()}_VISION_MODEL`;
}

/** `<ID>_MODEL` / `<ID>_VISION_MODEL`; for the custom provider, `AI_MODEL`. */
function modelOverride(spec: ProviderSpec, env: Record<string, string | undefined>): { text: string; vision: string } {
  const prefix = spec.id === 'custom' ? 'AI' : spec.id.toUpperCase();
  const text = normalizeApiKey(env[`${prefix}_MODEL`]);
  const visionRaw = env[`${prefix}_VISION_MODEL`];
  const vision = visionRaw === undefined ? undefined : normalizeApiKey(visionRaw);
  return {
    text: text || spec.textModel,
    // An explicitly blank variable disables images for that provider; an unset
    // one keeps the default.
    vision: vision === undefined ? spec.visionModel : vision,
  };
}

/** True when the operator has turned this provider on. */
function enabled(spec: ProviderSpec, env: Record<string, string | undefined>): boolean {
  if (spec.requiresEnv) {
    const value = env[spec.requiresEnv];
    if (!value || !value.trim()) return false;
    if (spec.baseUrlFromEnv && !/^https?:\/\//i.test(value.trim())) return false;
  }
  return spec.keyless === true || Boolean(normalizeApiKey(env[spec.keyEnv]));
}

/**
 * The providers this deployment can use, in the order they should be tried.
 *
 * `AI_PROVIDERS` names an explicit order (`openai,groq,custom`); anything the
 * operator configured but did not list is appended in table order, so adding a
 * key alone is enough to gain a fallback.
 */
export function resolveProviders(env: Record<string, string | undefined>): ResolvedProvider[] {
  const resolved: ResolvedProvider[] = [];
  for (const spec of PROVIDERS) {
    if (!enabled(spec, env)) continue;
    const base = spec.baseUrlFromEnv ? String(env[spec.requiresEnv ?? ''] ?? '') : spec.baseUrl;
    const url = chatUrl(base);
    if (!url) continue;
    const models = modelOverride(spec, env);
    // A custom endpoint with no model named has nothing to send.
    if (!models.text) continue;
    resolved.push({
      id: spec.id,
      label: spec.label,
      url,
      key: normalizeApiKey(env[spec.keyEnv]),
      textModel: models.text,
      visionModel: models.vision,
      reasoning: spec.reasoning ?? {},
      billingUrl: spec.billingUrl,
      keyUrl: spec.keyUrl,
      modelsUrl: spec.modelsUrl,
      keyEnv: spec.keyEnv,
    });
  }
  const order = String(env.AI_PROVIDERS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!order.length) return resolved;
  const byId = new Map(resolved.map((item) => [item.id, item]));
  const ordered: ResolvedProvider[] = [];
  for (const id of order) {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      byId.delete(id);
    }
  }
  return [...ordered, ...resolved.filter((item) => byId.has(item.id))];
}

/** What the status endpoint may safely report to the browser. */
export function describeProviders(providers: ResolvedProvider[]): { id: string; label: string; vision: boolean }[] {
  return providers.map((item) => ({ id: item.id, label: item.label, vision: Boolean(item.visionModel) }));
}

/**
 * Whether a failure from this provider is worth trying the next one for.
 *
 * A 400 is a bad request — every provider would reject it the same way, and
 * falling through would only turn a clear error into a slow one. Anything that
 * is about the provider's health, credit, or key is worth another attempt
 * elsewhere.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500;
}
