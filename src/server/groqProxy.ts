/**
 * Server-only Groq proxy shared by the Vercel Functions in `api/groq/*` and the
 * Vite dev/preview middleware in `vite.config.ts`.
 *
 * The Groq API key is passed in by the caller (read from `process.env.GROQ_API_KEY`
 * on the server). It is never returned in a response, logged, or bundled into
 * the browser build: nothing under `src/` that the React app imports references
 * this module.
 */

import { AI_DAILY_REQUESTS_DEFAULT, API_SECURITY_HEADERS, BodyTooLargeError, aiQuotaResponse, rateLimitResponse, readLimitedBody } from './security.js';
import {
  describeProviders,
  isRetryableStatus,
  modelEnvName,
  resolveProviders,
  visionModelEnvName,
  type ResolvedProvider,
} from './aiProviders.js';

export const GROQ_UPSTREAM_CHAT_COMPLETIONS = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * The model id the browser sends for a text request. The browser cannot know
 * which model this deployment picked, so it always names this one and the proxy
 * maps it onto `GROQ_MODEL` (defaulting to the same id). Keeping the browser's
 * vocabulary fixed is what lets GROQ_MODEL be changed without shipping a new
 * bundle — otherwise every request would be rejected as an unknown model.
 *
 * GPT-OSS 120B is a Groq *production* model: JSON object mode, 131K context,
 * 65,536 max output tokens.
 */
export const GROQ_DEFAULT_TEXT_MODEL = 'openai/gpt-oss-120b';
/**
 * The model id the browser sends when it has an image to read. Groq's text
 * models reject array content outright ("messages[1].content must be a
 * string"), so images go to a model that accepts `image_url` parts. Mapped onto
 * `GROQ_VISION_MODEL`; set that to an empty string to disable image input.
 */
export const GROQ_DEFAULT_VISION_MODEL = 'qwen/qwen3.8-27b';
/**
 * The model id the browser sends when it is editing a plan it already made.
 *
 * Revising a draft is not the same job as writing one: the shape, the dates
 * and the reasoning are all on the page already, and the model is being asked
 * to move a few things. Paying the largest model to do that is waste, and the
 * wait is longer than it needs to be.
 *
 * Mapped onto `GROQ_LIGHT_MODEL`. If no deployment sets one, the request falls
 * back to the ordinary text model — cheaper models are an opt-in, never a
 * silent downgrade of somebody's plan.
 */
export const GROQ_DEFAULT_LIGHT_MODEL = 'openai/gpt-oss-20b';

/**
 * Reasoning tokens count against `max_completion_tokens`, so leaving the effort
 * unspecified on a reasoning model lets the model's own default quietly eat the
 * budget meant for the answer — the reply arrives as truncated JSON. Only models
 * known to accept the knob get one; anything else, including a GROQ_MODEL
 * override, is sent untouched.
 *
 * 'low' is enough for turning a schedule into JSON; 'none' puts Qwen in
 * instruct mode, which is what reading a photo of a written plan needs.
 */
const REASONING_EFFORT_BY_MODEL: Record<string, string> = {
  'openai/gpt-oss-120b': 'low',
  'openai/gpt-oss-20b': 'low',
  'qwen/qwen3.8-27b': 'none',
};

/**
 * The last thing that touches a request before it leaves the proxy: the model
 * this deployment actually resolved, its reasoning effort, and image parts with
 * the OpenAI-only `detail` hint removed. Groq does not document `detail` and
 * charges a flat 2048 input tokens per image whatever it says, so forwarding it
 * buys nothing and risks a 400 from a provider that validates strictly.
 */
export function finalizeUpstreamBody(value: unknown, model: string, reasoningEffort?: string, stream = false): string {
  const record: Record<string, unknown> = isRecord(value) ? { ...value } : {};
  record.model = model;
  // Only ever forwarded when the caller asked for it: a streamed answer is a
  // different content type end to end, and a client expecting one JSON object
  // must never be silently handed a series of events instead.
  if (stream) record.stream = true;
  else delete record.stream;
  if (reasoningEffort) record.reasoning_effort = reasoningEffort;
  else delete record.reasoning_effort;
  if (Array.isArray(record.messages)) {
    record.messages = (record.messages as unknown[]).map((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return message;
      const content = (message.content as unknown[]).map((part) => {
        if (!isRecord(part) || !isRecord(part.image_url)) return part;
        const image: Record<string, unknown> = { ...(part.image_url as Record<string, unknown>) };
        delete image.detail;
        return { ...part, image_url: image };
      });
      return { ...message, content };
    });
  }
  return JSON.stringify(record);
}

/**
 * Vercel rejects function request bodies over 4.5 MB before our code runs, so
 * the proxy enforces a slightly lower ceiling to give a consistent, friendly
 * error locally and on Vercel.
 */
export const MAX_PROXY_BODY_BYTES = 4_400_000;
export const MAX_UPSTREAM_RESPONSE_BYTES = 2_000_000;

/** Must stay below the Vercel function max duration (300s default with Fluid compute). */
export const UPSTREAM_TIMEOUT_MS = 180_000;

export const MISSING_KEY_MESSAGE =
  'GROQ_API_KEY is not configured on the server. On Vercel, add it under Project Settings → Environment Variables and redeploy. Locally, add it to .env.local and restart the dev server.';

export const BILLING_CODE = 'billing';

export interface ChatProxyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** Overrides the allowed text model, e.g. from GROQ_MODEL. */
  model?: string;
  /** Overrides the allowed image model, e.g. from GROQ_VISION_MODEL. */
  visionModel?: string;
  /**
   * Resolved from the server environment by the router. Omit it and the
   * handler builds a single-provider list from `apiKey` + the model overrides,
   * which is the shape the tests and any older caller use.
   */
  providers?: ResolvedProvider[];
  /** The operator's AI_* variables, resolved here when no list is passed. */
  env?: Record<string, string | undefined>;
  /**
   * The signed-in account making this call, when there is one.
   *
   * Resolved by the router so this file stays free of session and database
   * concerns. Null for a local-only planner, which is then covered by the
   * per-client limiter alone.
   */
  accountId?: string | null;
}

/**
 * Keys are usually pasted into a dashboard field, and a surprising number of
 * copies pick up surrounding quotes, a "Bearer " prefix, or invisible
 * characters from a document. Each of those produces a 401 from the provider
 * while the key itself is perfectly valid, so clean it up before use.
 */
export { normalizeApiKey } from './aiProviders.js';

/**
 * The provider every message defaults to. Keeps the two-argument
 * `upstreamErrorResponse(status, body)` call — and the tests that pin its
 * Groq-specific wording — exactly as they were.
 */
const DEFAULT_PROVIDER: ResolvedProvider = {
  id: 'groq',
  label: 'Groq',
  url: GROQ_UPSTREAM_CHAT_COMPLETIONS,
  key: '',
  textModel: GROQ_DEFAULT_TEXT_MODEL,
  lightModel: '',
  visionModel: GROQ_DEFAULT_VISION_MODEL,
  reasoning: REASONING_EFFORT_BY_MODEL,
  billingUrl: 'https://console.groq.com/settings/billing',
  keyUrl: 'https://console.groq.com',
  modelsUrl: 'https://console.groq.com/docs/models',
  keyEnv: 'GROQ_API_KEY',
};

function defaultUpstreamMessage(code: string, provider: ResolvedProvider = DEFAULT_PROVIDER): string {
  const label = provider.label;
  const modelEnv = modelEnvName(provider.id);
  const visionEnv = visionModelEnvName(provider.id);
  if (code === 'upstream_auth') {
    const where = provider.keyUrl ? ` from ${provider.keyUrl}` : '';
    return `${label} rejected the API key. Re-copy it${where} into the ${provider.keyEnv} environment variable, then redeploy. Watch for stray quotes, spaces or a "Bearer " prefix around the key.`;
  }
  if (code === 'upstream_forbidden') {
    return `${label} refused this request for that key (403). The key may not have access to this model.`;
  }
  if (code === 'model_not_found') {
    const docs = provider.modelsUrl ? ` — see ${provider.modelsUrl} — ` : ' ';
    return `${label} does not recognise that model name. Set ${modelEnv} (or ${visionEnv} for image requests) on the server to a model your key can use${docs}and redeploy.`;
  }
  if (code === 'rate_limited') {
    return `${label} is rate-limiting this key right now. The free tier is capped per minute and per day; wait a moment and try again.`;
  }
  if (code === BILLING_CODE) {
    return billingErrorMessage('', provider);
  }
  return `${label} returned an error for this request.`;
}

/**
 * Groq answers a *valid* key with a 429 once the free tier's allowance is used
 * up, asking for a payment method. Nothing is misconfigured — the key
 * authenticated and Groq ran out of free allowance for it. Reporting that as
 * "check your key" sends people editing a perfectly good secret, so match the
 * billing wording and say what actually has to change.
 */
const BILLING_ERROR_PATTERNS: RegExp[] = [
  /add a payment method/i,
  /payment method (?:is )?(?:required|missing)/i,
  /insufficient[ _]?(?:credits?|quota|balance|funds)/i,
  /credit balance is too low/i,
  /exceeded your current (?:credits?|quota)/i,
  /no credits? (?:remaining|available|left)/i,
  /out of credits/i,
  /billing/i,
];

export function isBillingError(message: string): boolean {
  return BILLING_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function billingErrorMessage(message: string, provider: ResolvedProvider = DEFAULT_PROVIDER): string {
  const detail = message.trim() ? ` ${provider.label} said: “${message.trim()}”` : '';
  const topUp = provider.billingUrl ? `Add a payment method at ${provider.billingUrl}, or wait for the per-day free allowance to reset` : 'Top up the account on the provider’s site, or wait for the free allowance to reset';
  return (
    `Your ${provider.label} key is working — the account has just run out of free allowance, so ${provider.label} will not run any model for it. ` +
    `${topUp}, then try again: no redeploy is needed. ` +
    `You can also point ${modelEnvName(provider.id)} at a cheaper or higher-limit model.${detail}`
  );
}

/**
 * Upstream failures keep their status code but gain a stable code and Groq's own
 * message, so the app can explain what actually happened instead of guessing.
 *
 * Billing exhaustion is detected before the status mapping: Groq reports a used-up
 * free allowance as a 429, which otherwise reads as "slow down and retry" when
 * waiting will not help at all.
 */
export function upstreamErrorResponse(status: number, body: string, provider: ResolvedProvider = DEFAULT_PROVIDER): Response {
  let message = '';
  try {
    const parsed = JSON.parse(body) as unknown;
    const error = (parsed as { error?: unknown } | null)?.error;
    if (typeof error === 'string') message = error;
    else if (error && typeof error === 'object') message = String((error as { message?: unknown }).message ?? '');
  } catch {
    /* not JSON; fall back to the generic message */
  }
  if (isBillingError(message)) {
    return json(status, {
      error: { message: billingErrorMessage(message, provider), code: BILLING_CODE, upstream: status, provider: provider.id },
    });
  }
  const code =
    status === 401
      ? 'upstream_auth'
      : status === 403
        ? 'upstream_forbidden'
        : status === 404
          ? 'model_not_found'
          : status === 429
            ? 'rate_limited'
            : 'upstream_error';
  return json(status, {
    error: { message: message || defaultUpstreamMessage(code, provider), code, upstream: status, provider: provider.id },
  });
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function errorResponse(status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return json(status, { error: { message } }, extraHeaders);
}

export function hostOf(value: string | null): string {
  if (!value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Browsers attach `Origin` to cross-origin requests and to same-origin POSTs.
 * Requests without an Origin (curl, server-to-server, same-origin GET) are allowed;
 * a present Origin must match the Host/URL the request was addressed to. Forwarded
 * host headers are deliberately ignored so a caller cannot spoof an allowlisted host.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const originHost = hostOf(origin);
  if (!originHost) return false;
  const candidates = [
    request.headers.get('host'),
    hostOf(request.url),
  ]
    .flatMap((value) => (value ? value.split(',') : []))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(originHost);
}

function crossOriginResponse(): Response {
  return errorResponse(403, 'Cross-origin Groq proxy requests are not allowed.');
}

export function handleGroqStatus(request: Request, apiKey: string | undefined, providers?: ResolvedProvider[]): Response {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }
  const list = providers?.length ? providers : resolveProviders({ GROQ_API_KEY: apiKey });
  // Only names and capabilities are reported; no key ever leaves the server.
  return json(200, { configured: list.length > 0, providers: describeProviders(list) });
}

const MAX_MESSAGES = 10;
const MAX_MESSAGE_TEXT_BYTES = 80_000;
/**
 * Groq prefers `max_completion_tokens`; `max_tokens` is the deprecated alias it
 * still accepts. Both stay allowed so a browser running a cached older bundle
 * is not rejected by a newly deployed proxy.
 */
const ALLOWED_CHAT_KEYS = new Set(['model', 'messages', 'temperature', 'max_tokens', 'max_completion_tokens', 'response_format', 'stream']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validImageDataUrl(value: unknown): boolean {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(value);
}

function validMessageContent(value: unknown): { valid: boolean; textBytes: number } {
  if (typeof value === 'string') return { valid: true, textBytes: new TextEncoder().encode(value).byteLength };
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return { valid: false, textBytes: 0 };
  let textBytes = 0;
  for (const part of value) {
    if (!isRecord(part) || (part.type !== 'text' && part.type !== 'image_url')) return { valid: false, textBytes: 0 };
    if (part.type === 'text') {
      if (typeof part.text !== 'string') return { valid: false, textBytes: 0 };
      textBytes += new TextEncoder().encode(part.text).byteLength;
    } else {
      const image = isRecord(part.image_url) ? part.image_url : null;
      if (!image || !validImageDataUrl(image.url)) return { valid: false, textBytes: 0 };
      if (image.detail !== undefined && !['auto', 'low', 'high'].includes(String(image.detail))) return { valid: false, textBytes: 0 };
    }
  }
  return { valid: true, textBytes };
}

/** Only the narrow JSON shape used by Planner is allowed through the API-key proxy. */
export function validateChatPayload(
  value: unknown,
  allowedModels: string[] = [GROQ_DEFAULT_TEXT_MODEL],
  visionModels: string[] = [],
): string | null {
  if (!isRecord(value)) return 'The request body must be a JSON object.';
  if ([...Object.keys(value)].some((key) => !ALLOWED_CHAT_KEYS.has(key))) return 'The request contains an unsupported field.';
  if (typeof value.model !== 'string' || !allowedModels.includes(value.model)) {
    return 'That AI model is not available through this endpoint.';
  }
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_MESSAGES) return 'The request must contain a short messages list.';
  let textBytes = 0;
  let hasImage = false;
  for (const message of value.messages) {
    if (!isRecord(message) || !['system', 'user', 'assistant'].includes(String(message.role))) return 'The request contains an invalid message.';
    const content = validMessageContent(message.content);
    if (!content.valid) return 'The request contains invalid message content.';
    if (Array.isArray(message.content)) hasImage = true;
    textBytes += content.textBytes;
  }
  if (textBytes > MAX_MESSAGE_TEXT_BYTES) return 'The text in this request is too long.';
  // Groq's text models answer image parts with "content must be a string", so
  // name the real problem instead of forwarding a confusing upstream 400.
  if (hasImage && visionModels.length > 0 && !visionModels.includes(value.model)) {
    return `Image input needs the vision model (${visionModels[0]}), not ${String(value.model)}.`;
  }
  if (value.temperature !== undefined && (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) {
    return 'The temperature value is invalid.';
  }
  for (const key of ['max_tokens', 'max_completion_tokens']) {
    const limit = value[key];
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 16_000)) {
      return 'The token limit is invalid.';
    }
  }
  if (value.response_format !== undefined && (!isRecord(value.response_format) || value.response_format.type !== 'json_object')) {
    return 'The response format is invalid.';
  }
  if (value.stream !== undefined && typeof value.stream !== 'boolean') return 'The stream flag is invalid.';
  return null;
}

/**
 * The upstream body, delivered as it arrives.
 *
 * A streamed answer is not buffered whole: it is passed through as it is
 * produced, which is the entire point of asking for it. The size ceiling still
 * applies — only now it counts what has gone past rather than what came in.
 */
function streamLimitedResponse(response: Response, maxBytes: number, headers: HeadersInit): Response {
  if (!response.body) {
    return new Response(null, { status: response.status, headers });
  }
  const reader = response.body.getReader();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      sent += value.byteLength;
      if (sent > maxBytes) {
        controller.error(new BodyTooLargeError());
        await reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(stream, { status: response.status, headers });
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new BodyTooLargeError();
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
}

export async function handleGroqChatCompletions(
  request: Request,
  apiKey: string | undefined,
  options: ChatProxyOptions = {},
): Promise<Response> {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed.', { Allow: 'POST' });
  }
  const providers = options.providers?.length
    ? options.providers
    : resolveProviders(
        options.env ?? { GROQ_API_KEY: apiKey, GROQ_MODEL: options.model, GROQ_VISION_MODEL: options.visionModel },
      );
  if (!providers.length) return errorResponse(503, MISSING_KEY_MESSAGE);
  // Groq's free tier is capped per minute as well as per day, so the proxy's own
  // ceiling sits below it and returns a friendly message first.
  const limited = rateLimitResponse(request, 'groq-chat', 20, 60_000);
  if (limited) return limited;

  // A daily allowance per account, on top of the per-client brake. Without it
  // one signed-in account can spend the whole deployment's key. Only counted
  // when there is an account: the planner is meant to work without one.
  if (options.accountId) {
    const configured = Number(options.env?.AI_DAILY_REQUESTS);
    const daily = configured >= 0 ? configured : AI_DAILY_REQUESTS_DEFAULT;
    const overQuota = aiQuotaResponse(options.accountId, daily);
    if (overQuota) return overQuota;
  }

  let body: string;
  try {
    body = await readLimitedBody(request, options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, 'The image or plan is too large for one request. Use a smaller image (up to 3 MB).');
    }
    return errorResponse(400, 'The request body could not be read.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return errorResponse(400, 'The request body must be JSON.');
  }
  const requested = isRecord(parsed) && typeof parsed.model === 'string' ? parsed.model : '';
  /**
   * The browser can only name the role it needs — it has no way to know which
   * model this deployment picked, let alone which provider will answer. So the
   * ids accepted here are the role defaults *plus* every configured model, and
   * the request is resolved to a role before validation, not after. Validating
   * the requested id against one resolved model would reject every request the
   * moment GROQ_MODEL is set.
   */
  const visionIds = [...new Set([GROQ_DEFAULT_VISION_MODEL, ...providers.map((item) => item.visionModel).filter(Boolean)])];
  const isVisionRequest = visionIds.includes(requested);
  // An explicitly blank vision model disables image input instead of quietly
  // routing images to a text model that rejects array content upstream.
  // With several providers, images are disabled only if *none* can read them.
  if (requested === GROQ_DEFAULT_VISION_MODEL && !providers.some((item) => item.visionModel)) {
    return errorResponse(
      400,
      'Image input is turned off on this deployment. Set GROQ_VISION_MODEL to a multimodal model such as qwen/qwen3.8-27b, or send the request without an image.',
    );
  }
  // A light request names the cheap model, or any provider's configured light
  // model. It counts as a text request for validation: otherwise it would look
  // like an unknown model, be passed through verbatim, and reach the provider
  // as a name this deployment never chose.
  const isLightRequest = requested === GROQ_DEFAULT_LIGHT_MODEL || providers.some((item) => item.lightModel === requested);
  const isTextRequest =
    requested === GROQ_DEFAULT_TEXT_MODEL ||
    isLightRequest ||
    providers.some((item) => item.textModel === requested);
  // A request that names neither role nor a configured model is passed through
  // unchanged, which is what the single-provider path always did.
  const passthroughModel = !isVisionRequest && !isTextRequest ? requested : '';
  const allowedModels = [
    ...new Set([
      GROQ_DEFAULT_TEXT_MODEL,
      GROQ_DEFAULT_LIGHT_MODEL,
      ...providers.map((item) => item.textModel),
      ...providers.map((item) => item.lightModel).filter(Boolean),
      ...visionIds,
      ...(passthroughModel ? [passthroughModel] : []),
    ]),
  ];
  const validationError = validateChatPayload(parsed, allowedModels, visionIds);
  if (validationError) return errorResponse(400, validationError);

  const fetchImpl = options.fetchImpl ?? fetch;
  const wantsStream = isRecord(parsed) && parsed.stream === true;
  const attempts: string[] = [];
  /**
   * The failure worth reporting when every provider is tried.
   *
   * "First tried" is not always "most useful": a timeout on the primary says
   * nothing actionable if the fallback then rejected the key. So a diagnosis
   * from a provider ranks above a transport failure, and a misconfiguration
   * the operator can fix ranks above a transient rate limit.
   */
  const failures: { response: Response; rank: number }[] = [];
  const remember = (response: Response, rank: number): void => {
    failures.push({ response, rank });
  };
  /** Higher wins. 4 = fix a setting, 3 = top up, 2 = wait, 1 = unreachable. */
  const rankOf = (status: number, body: string): number => {
    if (status === 401 || status === 403 || status === 404) return 4;
    if (isBillingError(readUpstreamMessage(body))) return 3;
    return 2;
  };

  for (const provider of providers) {
    // Skip a provider that cannot do what this request needs: a text-only
    // provider asked to read an image would only return a confusing 400.
    const model = isVisionRequest
      ? provider.visionModel
      : passthroughModel ||
        (isLightRequest && provider.lightModel ? provider.lightModel : provider.textModel);
    if (!model) continue;
    const outgoingBody = finalizeUpstreamBody(parsed, model, provider.reasoning[model], wantsStream);
    attempts.push(`${provider.id}:${model}`);
    try {
      const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
      // A streamed answer cannot be measured with one timer: the wait that
      // matters is the wait for the first byte, and once the model has started
      // writing, cutting it off at an arbitrary second would only lose work.
      // So the deadline covers the headers, and the stream then runs until it
      // finishes, the size ceiling stops it, or the browser hangs up.
      const controller = wantsStream ? new AbortController() : null;
      const deadline = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let upstream: Response;
      try {
        upstream = await fetchImpl(provider.url, {
          method: 'POST',
          headers: {
            // A keyless provider (a local Ollama) gets no Authorization header.
            ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}),
            'Content-Type': 'application/json',
            Accept: wantsStream ? 'text/event-stream' : 'application/json',
          },
          body: outgoingBody,
          signal: controller ? controller.signal : AbortSignal.timeout(timeoutMs),
        });
      } finally {
        if (deadline) clearTimeout(deadline);
      }
      const headers = {
        'Content-Type': wantsStream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        // Which provider answered: the one clue worth having in a log.
        'X-AI-Provider': provider.id,
        ...API_SECURITY_HEADERS,
      };
      if (upstream.ok) {
        if (wantsStream) return streamLimitedResponse(upstream, MAX_UPSTREAM_RESPONSE_BYTES, headers);
        const responseBody = await readLimitedResponse(upstream, MAX_UPSTREAM_RESPONSE_BYTES);
        return new Response(responseBody, { status: upstream.status, headers });
      }
      const responseBody = await readLimitedResponse(upstream, MAX_UPSTREAM_RESPONSE_BYTES);
      const failure = upstreamErrorResponse(upstream.status, responseBody, provider);
      remember(failure, rankOf(upstream.status, responseBody));
      // A 400 is a bad request: every provider would reject it the same way,
      // so falling through would only turn a clear error into a slow one.
      if (!isRetryableStatus(upstream.status)) return withAttempts(failure, attempts);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        // Nothing else to try: the answer was already too big once.
        return withAttempts(errorResponse(502, `The ${provider.label} response was too large.`), attempts);
      }
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      remember(
        timedOut
          ? errorResponse(504, `The ${provider.label} request timed out. Please try again.`)
          : errorResponse(502, `Could not reach ${provider.label}. Check the server connection and try again.`),
        1,
      );
      // Unreachable or too slow: try the next provider before giving up.
    }
  }
  const worst = failures.reduce<{ response: Response; rank: number } | null>(
    (best, failure) => (!best || failure.rank > best.rank ? failure : best),
    null,
  );
  return withAttempts(worst?.response ?? errorResponse(503, MISSING_KEY_MESSAGE), attempts.length ? attempts : ['none']);
}

/** The provider's own explanation of a failure, if it sent one. */
function readUpstreamMessage(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') return String((error as { message?: unknown }).message ?? '');
  } catch {
    /* not JSON */
  }
  return '';
}

/** Attach the providers that were tried, so a log line can explain a fallback. */
function withAttempts(response: Response, attempts: string[]): Response {
  const headers = new Headers(response.headers);
  headers.set('X-AI-Attempts', attempts.join(' '));
  return new Response(response.body, { status: response.status, headers });
}
