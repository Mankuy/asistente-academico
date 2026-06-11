const express = require('express');
const helmet = require('helmet');
const Joi = require('joi');
const path = require('path');
const fs = require('fs');
const {
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  addChapter,
  deleteChapter,
  renameChapter,
  reorderChapters,
  recordSessionUsage,
  buildSessionContextForLlm,
} = require('./sessions_store');
const {
  GUARDIAN_SYSTEM_PROMPT,
  classifyIntentRegex,
  parseGuardianJson,
  estimateCostUsd,
  estimateStageCostUsd,
} = require('./guardian');
const {
  isBunkerMode,
  isLocalhostEndpoint,
  assertBunkerAllowsEndpoint,
} = require('./bunker');
const {
  AUDIT_JSON_SCHEMA_HINT,
  sanitizeZeroWidth,
  extractAuditJSON,
  formatAuditForRewrite,
  filterAcceptedSuggestions,
} = require('./audit_json');
const {
  rebuildBibliotecaIndex,
  searchBibliotecaLocal,
  formatLocalBibliotecaHits,
  getBibliotecaStatus,
} = require('./biblioteca_store');
const {
  safeEntregablePath,
  exportDocxEntregable,
  buildSessionExportText,
} = require('./docx_export');
const { exportPdfEntregable } = require('./pdf_export');
const {
  verifyRewriteIntegrity,
  extractCitations,
} = require('./integrity_verify');

const ENV_PATH = path.join(__dirname, '.env');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;

  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    if (!(parsed.key in process.env)) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function formatEnvValue(value) {
  if (value === '') return '';
  if (/[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function saveEnvVariable(key, value) {
  const serialized = formatEnvValue(value);
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
    : [];

  let found = false;
  const updated = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return line;
    if (parsed.key === key) {
      found = true;
      return `${key}=${serialized}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${key}=${serialized}`);
  }

  const content = updated.join('\n').replace(/\n+$/, '') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  process.env[key] = value;
}

function parseJsonEnv(key, fallback = {}) {
  const raw = (process.env[key] || '').trim();
  if (!raw) return { ...fallback };
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function saveJsonEnvVariable(key, obj) {
  const serialized = JSON.stringify(obj);
  saveEnvVariable(key, serialized);
  process.env[key] = serialized;
}

function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 8) return null;
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

loadEnvFile();

const LLM_PROVIDER_IDS = [
  'openrouter',
  'openai',
  'anthropic',
  'groq',
  'nous',
  'google',
  'mistral',
  'together',
  'deepseek',
  'cohere',
  'perplexity',
  'fireworks',
  'xai',
  'nvidia',
  'azure',
  'local',
  'custom',
];

const LLM_PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openrouter/owl-alpha',
    docsUrl: 'https://openrouter.ai/keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/api-keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  anthropic: {
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-sonnet-20241022',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    apiStyle: 'anthropic',
    keyOptional: false,
  },
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  nous: {
    label: 'Nous Research',
    endpoint: 'https://inference-api.nousresearch.com/v1/chat/completions',
    defaultModel: 'hermes-3-llama-3.1-70b',
    docsUrl: 'https://nousresearch.com',
    apiStyle: 'openai',
    keyOptional: false,
  },
  google: {
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.0-flash',
    docsUrl: 'https://aistudio.google.com/apikey',
    apiStyle: 'openai',
    keyOptional: false,
  },
  mistral: {
    label: 'Mistral AI',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    docsUrl: 'https://console.mistral.ai/api-keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  together: {
    label: 'Together AI',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-3-8b-chat-hf',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  cohere: {
    label: 'Cohere',
    endpoint: 'https://api.cohere.com/v2/chat',
    defaultModel: 'command-r-plus',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    apiStyle: 'cohere',
    keyOptional: false,
  },
  perplexity: {
    label: 'Perplexity',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    defaultModel: 'sonar',
    docsUrl: 'https://www.perplexity.ai/settings/api',
    apiStyle: 'openai',
    keyOptional: false,
  },
  fireworks: {
    label: 'Fireworks AI',
    endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    docsUrl: 'https://fireworks.ai/account/api-keys',
    apiStyle: 'openai',
    keyOptional: false,
  },
  xai: {
    label: 'xAI (Grok)',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    defaultModel: 'grok-2-latest',
    docsUrl: 'https://console.x.ai',
    apiStyle: 'openai',
    keyOptional: false,
  },
  nvidia: {
    label: 'NVIDIA NIM',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    docsUrl: 'https://build.nvidia.com',
    apiStyle: 'openai',
    keyOptional: false,
  },
  azure: {
    label: 'Azure OpenAI',
    endpoint: '',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://portal.azure.com',
    apiStyle: 'openai',
    keyOptional: false,
  },
  local: {
    label: 'Local (Ollama / LM Studio)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'llama3.2',
    docsUrl: 'https://ollama.com',
    apiStyle: 'openai',
    keyOptional: true,
  },
  custom: {
    label: 'Custom (URL propia)',
    endpoint: '',
    defaultModel: '',
    docsUrl: '',
    apiStyle: 'openai',
    keyOptional: true,
  },
};

const CONFIG = {
  LLM_PROVIDER: 'openrouter',
  LLM_API_KEY: '',
  LLM_MODEL: 'openrouter/owl-alpha',
  LLM_BASE_URL: '',
  LLM_KEYS_JSON: '{}',
  LLM_MODELS_JSON: '{}',
  LLM_FAST_MODELS_JSON: '{}',
  LLM_BASE_URLS_JSON: '{}',
  COST_CONFIRM_THRESHOLD_USD: '0.10',
  BUNKER_MODE: 'false',
  BIND_HOST: '127.0.0.1',
};

function getLlmProvider(providerId) {
  return LLM_PROVIDERS[providerId] || LLM_PROVIDERS.openrouter;
}

function getLlmProviderId() {
  const provider = (process.env.LLM_PROVIDER || CONFIG.LLM_PROVIDER || 'openrouter').trim();
  return LLM_PROVIDER_IDS.includes(provider) ? provider : 'openrouter';
}

const PROVIDER_ENV_KEY_ALIASES = {
  openrouter: ['OPENROUTER_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  groq: ['GROQ_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  xai: ['XAI_API_KEY'],
  nvidia: ['NVIDIA_API_KEY', 'NIM_API_KEY'],
};

function loadLlmKeysStore() {
  const keys = parseJsonEnv('LLM_KEYS_JSON', {});

  const legacyKey = (process.env.LLM_API_KEY || CONFIG.LLM_API_KEY || '').trim();
  const legacyProvider = (process.env.LLM_PROVIDER || CONFIG.LLM_PROVIDER || 'openrouter').trim();
  if (legacyKey && !keys[legacyProvider]) {
    keys[legacyProvider] = legacyKey;
  }

  for (const [providerId, envNames] of Object.entries(PROVIDER_ENV_KEY_ALIASES)) {
    if (keys[providerId]) continue;
    for (const envName of envNames) {
      const envValue = (process.env[envName] || '').trim();
      if (envValue) {
        keys[providerId] = envValue;
        break;
      }
    }
  }

  return keys;
}

function loadLlmModelsStore() {
  const models = parseJsonEnv('LLM_MODELS_JSON', {});
  const legacyModel = (process.env.LLM_MODEL || CONFIG.LLM_MODEL || process.env.OPENROUTER_MODEL || CONFIG.OPENROUTER_MODEL || '').trim();
  const legacyProvider = (process.env.LLM_PROVIDER || CONFIG.LLM_PROVIDER || 'openrouter').trim();
  if (legacyModel && !models[legacyProvider]) {
    models[legacyProvider] = legacyModel;
  }
  return models;
}

function loadLlmFastModelsStore() {
  return parseJsonEnv('LLM_FAST_MODELS_JSON', {});
}

function getLlmFastModel(providerId = getLlmProviderId()) {
  const fastModels = loadLlmFastModelsStore();
  const fast = (fastModels[providerId] || '').trim();
  if (fast) return fast;
  return getLlmModel(providerId);
}

function getCostConfirmThreshold() {
  const raw = (process.env.COST_CONFIRM_THRESHOLD_USD || CONFIG.COST_CONFIRM_THRESHOLD_USD || '0.10').trim();
  const value = Number(raw);
  if (Number.isNaN(value) || value < 0) return 0.1;
  return value;
}

function getBindHost() {
  return (process.env.BIND_HOST || CONFIG.BIND_HOST || '127.0.0.1').trim() || '127.0.0.1';
}

function loadLlmBaseUrlsStore() {
  const urls = parseJsonEnv('LLM_BASE_URLS_JSON', {});
  const legacyUrl = (process.env.LLM_BASE_URL || CONFIG.LLM_BASE_URL || '').trim();
  const legacyProvider = (process.env.LLM_PROVIDER || CONFIG.LLM_PROVIDER || 'openrouter').trim();
  if (
    legacyUrl &&
    (legacyProvider === 'local' || legacyProvider === 'custom' || legacyProvider === 'azure') &&
    !urls[legacyProvider]
  ) {
    urls[legacyProvider] = legacyUrl;
  }
  return urls;
}

function getLlmApiKey(providerId = getLlmProviderId()) {
  const keys = loadLlmKeysStore();
  return (keys[providerId] || '').trim();
}

function getLlmModel(providerId = getLlmProviderId()) {
  const models = loadLlmModelsStore();
  return (
    models[providerId] ||
    process.env.LLM_MODEL ||
    CONFIG.LLM_MODEL ||
    getLlmProvider(providerId).defaultModel
  ).trim();
}

function getLlmBaseUrl(providerId = getLlmProviderId()) {
  const urls = loadLlmBaseUrlsStore();
  const custom = (urls[providerId] || process.env.LLM_BASE_URL || CONFIG.LLM_BASE_URL || '').trim();
  if (providerId === 'custom' || providerId === 'azure') return custom;
  if (providerId === 'local') {
    if (custom) return custom;
    return LLM_PROVIDERS.local.endpoint;
  }
  return LLM_PROVIDERS[providerId].endpoint;
}

function getMaskedKeysForAllProviders() {
  const keys = loadLlmKeysStore();
  const masked = {};
  for (const id of LLM_PROVIDER_IDS) {
    masked[id] = maskApiKey(keys[id]);
  }
  return masked;
}

function isProviderConfigured(providerId) {
  const provider = getLlmProvider(providerId);
  const key = getLlmApiKey(providerId);
  const model = getLlmModel(providerId);
  if (!model) return false;
  if (provider.keyOptional) {
    if (providerId === 'local' || providerId === 'custom' || providerId === 'azure') {
      return Boolean(getLlmBaseUrl(providerId));
    }
    return true;
  }
  return Boolean(key);
}

function isLlmConfigured() {
  return isProviderConfigured(getLlmProviderId());
}

function buildProviderHeaders(providerId, apiKey) {
  const headers = { 'Content-Type': 'application/json' };

  if (providerId === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return headers;
  }

  if (providerId === 'cohere') {
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER || `http://localhost:${PORT}`;
    headers['X-Title'] = 'Tutor Académico de Escritura';
  }

  return headers;
}

const LLM_MAX_TOKENS_AUDIT = 8000;
const LLM_MAX_TOKENS_REWRITE = 10000;

function supportsJsonResponseFormat(providerId) {
  return !['anthropic', 'cohere'].includes(providerId);
}

function buildLlmRequestBody(
  providerId,
  systemPrompt,
  userText,
  model,
  maxTokens = LLM_MAX_TOKENS_REWRITE,
  temperature = 0.3,
  jsonMode = false
) {
  if (providerId === 'anthropic') {
    return {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    };
  }

  if (providerId === 'cohere') {
    return {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    };
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode && supportsJsonResponseFormat(providerId)) {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

function normalizeLlmCallOpts(opts = {}) {
  if (typeof opts === 'number') {
    return { maxTokens: opts };
  }
  if (!opts || typeof opts !== 'object') {
    return {};
  }
  return opts;
}

function extractLlmContent(providerId, data) {
  if (providerId === 'anthropic') {
    const block = data.content?.find((item) => item.type === 'text');
    return block?.text || '';
  }

  if (providerId === 'cohere') {
    return data.message?.content?.[0]?.text || data.text || '';
  }

  return data.choices?.[0]?.message?.content || '';
}

const LLM_RETRY_MAX_ATTEMPTS = 5;
const LLM_RETRY_BASE_MS = 1500;
const LLM_RETRY_MAX_MS = 90000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 520 || status === 529;
}

function isRetryableErrorMessage(message) {
  return /rate.?limit|too many requests|overloaded|temporarily unavailable|service unavailable|timeout|try again|retry after|capacity|throttl|busy/i.test(message || '');
}

function parseRetryAfterMs(response, errorMessage) {
  const header = response?.headers?.get('retry-after') || response?.headers?.get('Retry-After');
  if (header) {
    const asNumber = Number(header);
    if (!Number.isNaN(asNumber) && asNumber >= 0) {
      return Math.min(Math.max(asNumber * 1000, 500), LLM_RETRY_MAX_MS);
    }
    const asDate = Date.parse(header);
    if (!Number.isNaN(asDate)) {
      return Math.min(Math.max(asDate - Date.now(), 500), LLM_RETRY_MAX_MS);
    }
  }

  const patterns = [
    /retry[- ]?after[:\s]+(\d+(?:\.\d+)?)\s*s/i,
    /try again in (\d+(?:\.\d+)?)\s*seconds?/i,
    /wait (\d+(?:\.\d+)?)\s*seconds?/i,
    /(\d+(?:\.\d+)?)\s*seconds?.*(?:rate|limit|retry)/i,
  ];

  for (const pattern of patterns) {
    const match = String(errorMessage || '').match(pattern);
    if (match) {
      return Math.min(Math.max(parseFloat(match[1]) * 1000, 500), LLM_RETRY_MAX_MS);
    }
  }

  return null;
}

function computeRetryDelayMs(attempt, retryAfterMs) {
  if (retryAfterMs) return retryAfterMs;
  const exponential = Math.min(LLM_RETRY_BASE_MS * (2 ** (attempt - 1)), LLM_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

async function callLlmOnce(systemPrompt, userText, opts = {}) {
  const callOpts = normalizeLlmCallOpts(opts);
  const maxTokens = callOpts.maxTokens ?? LLM_MAX_TOKENS_REWRITE;
  const temperature = callOpts.temperature ?? 0.3;
  const jsonMode = Boolean(callOpts.jsonMode);
  const providerId = getLlmProviderId();
  const provider = getLlmProvider(providerId);
  const apiKey = getLlmApiKey();
  const model = callOpts.model ?? getLlmModel();
  const endpoint = getLlmBaseUrl();

  if (!provider.keyOptional && !apiKey) {
    throw new ApiError(
      'API Key no configurada',
      503,
      `Abrí la configuración (⚙️) y guardá tu API Key para ${provider.label}`,
      { retryable: false }
    );
  }

  if (!model) {
    throw new ApiError('Modelo LLM no configurado', 503, 'Indicá un modelo en la configuración (⚙️).', { retryable: false });
  }

  if ((providerId === 'custom' || providerId === 'local' || providerId === 'azure') && !endpoint) {
    throw new ApiError('URL del proveedor no configurada', 503, 'Ingresá la URL base para el proveedor seleccionado.', { retryable: false });
  }

  if (isBunkerMode()) {
    try {
      assertBunkerAllowsEndpoint(endpoint);
    } catch (bunkerErr) {
      throw new ApiError(
        'Modo Búnker activo',
        403,
        'Solo se permiten modelos locales (localhost). Desactivá Modo Búnker en ⚙️ o configurá Ollama/LM Studio.',
        { retryable: false }
      );
    }
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildProviderHeaders(providerId, apiKey),
      body: JSON.stringify(buildLlmRequestBody(providerId, systemPrompt, userText, model, maxTokens, temperature, jsonMode)),
      signal: AbortSignal.timeout(300000),
    });
  } catch (networkErr) {
    const isTimeout = networkErr.name === 'AbortError' || networkErr.name === 'TimeoutError';
    throw new ApiError(
      isTimeout ? `Tiempo de espera agotado (${provider.label})` : `No se pudo conectar con ${provider.label}`,
      isTimeout ? 504 : 502,
      networkErr.message,
      { retryable: true }
    );
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    const bodySnippet = rawText.substring(0, 100);
    const isFake200 = response.status === 200;
    const retryable = isFake200 || isRetryableHttpStatus(response.status);
    const details = isFake200
      ? `Provider returned invalid JSON despite HTTP 200. Body snippet: ${bodySnippet}`
      : `HTTP ${response.status}: respuesta no JSON. Body snippet: ${bodySnippet}`;
    throw new ApiError(
      `${provider.label} devolvió una respuesta no válida`,
      502,
      details,
      { retryable }
    );
  }

  if (!response.ok) {
    const providerMessage = data?.error?.message || data?.message || JSON.stringify(data);
    const retryAfterMs = parseRetryAfterMs(response, providerMessage);
    const retryable = isRetryableHttpStatus(response.status) || isRetryableErrorMessage(providerMessage);
    throw new ApiError(
      `${provider.label} rechazó la solicitud`,
      response.status === 429 ? 429 : 502,
      `HTTP ${response.status}: ${providerMessage}`,
      { retryable, retryAfterMs }
    );
  }

  const content = extractLlmContent(providerId, data);
  if (!content) {
    throw new ApiError(
      `${provider.label} no devolvió contenido en la respuesta`,
      502,
      'La respuesta no incluyó texto utilizable.',
      { retryable: true }
    );
  }

  return { content, modelUsed: model };
}

async function callLlm(systemPrompt, userText, opts = {}) {
  const callOpts = normalizeLlmCallOpts(opts);
  const provider = getLlmProvider(getLlmProviderId());
  let lastError = null;

  for (let attempt = 1; attempt <= LLM_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await callLlmOnce(systemPrompt, userText, callOpts);
    } catch (err) {
      lastError = err;
      const canRetry = err instanceof ApiError && err.retryable && attempt < LLM_RETRY_MAX_ATTEMPTS;
      if (!canRetry) throw err;

      const waitMs = computeRetryDelayMs(attempt, err.retryAfterMs);
      console.warn(
        `[callLlm] ${provider.label}: reintento ${attempt + 1}/${LLM_RETRY_MAX_ATTEMPTS} en ${waitMs}ms — ${err.details || err.message}`
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app_frontend.html'));
});

const ETHICS_CORE_PROMPT = `
Directrices éticas inmutables (Policy Engine):
1. **Prohibición de evasión:** NUNCA ayudes a evadir detectores de plagio o de IA. Si detectas esa intención, declina.
2. **Dominio académico:** Solo escritura académica. Rechaza código, consejo médico, etc.
3. **Neutralidad:** No juzgues ideología; evalúa forma, lógica, evidencia y normativa.
4. **Sin ofuscación:** No uses caracteres Unicode invisibles ni zero-width spaces.
`.trim();

const SYSTEM_PROMPT_V3 = `
System Prompt (versión 3.1 — Potencia Industrial)

Eres un **Auditor Académico de Élite** y **Editor Científico Senior**. Tu estándar es publicación en revista indexada, no un simple resumen escolar.

**Nivel de crítica: BRUTALMENTE HONESTO**
- No seas perezoso ni complaciente. Si hay errores de lógica, citación, coherencia, tono o rigor, márcalos SIN PIEDAD.
- Honestidad también significa NO inventar problemas para parecer riguroso. Si un aspecto está correcto, declaralo correcto. No hay cuota mínima de sugerencias; un texto excelente puede tener cero observaciones críticas.
- Cada observación debe citar la norma (APA 7ª, MLA 9ª, Chicago 17ª, Vancouver) o principio académico violado.
- Adapta la exigencia al [Contexto] de nivel y normativa provistos.
- Objetivo: calidad de publicación científica.
- Respondé en el mismo idioma del texto del usuario.
- **Contexto académico:** Si detectas citas, intenta utilizar el [Academic Context] provisto para completar datos faltantes (como años correctos, DOIs o páginas aproximadas). Si la página exacta no está en el contexto, mantén el marcador [XX]. NUNCA inventes números de página o DOIs.

` + ETHICS_CORE_PROMPT;

const AUDIT_SYSTEM_PROMPT_V3 = SYSTEM_PROMPT_V3 + `

**MODO: AUDITORÍA (Fase 1) — SOLO DIAGNÓSTICO**

Analiza el texto del usuario con rigor de revisor de comité editorial. NO reescribas el texto completo.

**Salida OBLIGATORIA (solo auditoría):**
1. **Resumen ejecutivo** (2-4 líneas): veredicto general sobre aptitud del texto.
2. **Errores críticos** numerados: lógica, citación, plagio potencial, estructura, tono académico.
3. **Sugerencias detalladas** numeradas. Para cada una:
   - Fragmento problemático (cita literal)
   - Corrección propuesta
   - Justificación normativa o de rigor
   - Severidad: [CRÍTICO] | [IMPORTANTE] | [MENOR]
4. **Checklist normativo**: formato de citas, referencias, voz académica.
5. **Verificación bibliográfica**: contrasta citas in-text con el [Academic Context] de Crossref; señala discrepancias de autor, año, DOI o páginas.

PROHIBIDO incluir "Texto Final Optimizado" o reescritura completa. Solo auditoría y sugerencias.
`;

const AUDIT_SYSTEM_PROMPT_JSON = SYSTEM_PROMPT_V3 + `

**MODO: AUDITORÍA (Fase 1) — SALIDA JSON ESTRUCTURADA**

Analiza el texto del usuario con rigor de revisor de comité editorial. NO reescribas el texto completo.

**Respondé ÚNICAMENTE con un objeto JSON válido** (sin markdown, sin texto antes ni después) con esta forma exacta:
${AUDIT_JSON_SCHEMA_HINT}

Reglas:
- "sugerencias" debe listar cada problema accionable con quote literal del texto original.
- "severity" solo puede ser CRÍTICO, IMPORTANTE o MENOR.
- "veredicto" solo puede ser apto, apto_con_reservas o no_apto.
- Usá el [Academic Context] para "biblio_check" cuando haya citas verificables.
- PROHIBIDO incluir reescritura completa del documento.

**Ejemplo compacto (entrada → salida):**
Entrada: "Según Smith (2020), el 45% de los casos no citan correctamente (García, 2019)."
Salida:
{
  "resumen": "Hay un error de año en una cita parentética; el resto es coherente.",
  "veredicto": "apto_con_reservas",
  "sugerencias": [{
    "id": "s1",
    "quote": "(García, 2019)",
    "replacement": "(García, 2018)",
    "explanation": "El año no coincide con la fuente del contexto académico.",
    "norm_ref": "APA 7ª — precisión en citas parentéticas",
    "severity": "IMPORTANTE"
  }],
  "checklist": ["Verificar años de todas las citas parentéticas"],
  "biblio_check": ["García publicó en 2018 según el contexto provisto"]
}
`;

const REWRITE_SYSTEM_PROMPT_V3 = SYSTEM_PROMPT_V3 + `

**MODO: REESCRITURA (Fase 2) — TEXTO OPTIMIZADO**

Recibirás el texto original del usuario Y el informe de auditoría de la Fase 1.

**Tu tarea:** Devuelve el **Texto Final Optimizado** seguido de referencias:
- Aplicá ÚNICAMENTE las correcciones listadas en el informe. NO introduzcas cambios adicionales no listados, salvo errores ortográficos objetivos.
- NO alteres citas, años, cifras ni nombres propios que el informe no haya marcado.
- Mantén la estructura de párrafos y la intención académica del autor.
- Calidad de borrador listo para envío a tutor o revista.
- Usa el [Academic Context] para completar metadatos bibliográficos reales cuando estén disponibles.
- NO repitas la auditoría ni incluyas explicaciones meta.
- Al final del texto optimizado, DEBES agregar una sección llamada '### Referencias Bibliográficas' que liste todas las obras citadas siguiendo estrictamente el formato APA o MLA indicado en el [Contexto].
`;

// TODO(composer-v2): "Doble Lectura" — toggle OFF por defecto; el FAST model relee
// original vs optimizado buscando cambios de sentido. Fuera del MVP; no improvisar otra variante.

const SYSTEM_PROMPT_V2_3 = SYSTEM_PROMPT_V3;

class ApiError extends Error {
  constructor(message, statusCode = 502, details = null, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.retryable = Boolean(options.retryable);
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

function classifyIntent(text) {
  return classifyIntentRegex(text);
}

async function classifyIntentLLM(text, guardianModel = null) {
  const snippet = String(text || '').trim().slice(0, 600);
  if (!snippet) return 'unknown';

  if (isBunkerMode()) {
    const endpoint = getLlmBaseUrl();
    if (!isLocalhostEndpoint(endpoint)) {
      return 'unknown';
    }
  }

  const model = String(guardianModel || '').trim() || getLlmFastModel();

  try {
    const { content: raw } = await callLlmOnce(GUARDIAN_SYSTEM_PROMPT, snippet, {
      model,
      maxTokens: 20,
      temperature: 0,
    });
    return parseGuardianJson(raw).intent;
  } catch (err) {
    console.warn('[guardian] LLM fallback fail-open:', err.message || err);
    return 'unknown';
  }
}

async function containsEvasionIntent(text, guardianModel = null) {
  const regexIntent = classifyIntentRegex(text);
  if (regexIntent === 'evasion') return true;
  if (regexIntent === 'academic_help') return false;

  const llmIntent = await classifyIntentLLM(text, guardianModel);
  return llmIntent === 'evasion';
}

const NORMATIVA_OPTIONS = ['APA 7ª ed.', 'MLA 9ª ed.', 'Chicago 17ª', 'Vancouver'];
const NIVEL_OPTIONS = [
  'Trabajo de Grado',
  'Trabajo Final de Grado',
  'Ensayo Universitario',
  'Trabajo de Especialización de Posgrado',
  'Trabajo de Maestría',
  'Tesis de Maestría',
  'Trabajo de Doctorado',
  'Tesis de Doctorado',
  'Trabajo de Postdoctorado',
  'Tesis de Postdoctorado',
  'Artículo Científico',
];

const CITATION_IN_TEXT_REGEX = /\(([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]*,?\s*\d{4}[a-z]?)\)/g;
const MAX_ACADEMIC_LOOKUPS = 6;

function extractCitationQueries(inputText) {
  const queries = new Set();
  const regex = new RegExp(CITATION_IN_TEXT_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(inputText)) !== null) {
    queries.add(match[1].trim());
    if (queries.size >= MAX_ACADEMIC_LOOKUPS) break;
  }
  return [...queries];
}

function formatCrossrefWork(item) {
  const title = item.title?.[0] || 'Sin título';
  const authors = (item.author || [])
    .map((author) => `${author.family || ''}${author.given ? `, ${author.given}` : ''}`.trim())
    .filter(Boolean)
    .join('; ') || 'Autor desconocido';
  const year = item.issued?.['date-parts']?.[0]?.[0] || 's.f.';
  const doi = item.DOI ? `https://doi.org/${item.DOI}` : 'Sin DOI';
  const pages = item.page || 'Sin páginas';
  const publisher = item.publisher || 'Editorial no disponible';
  return `Título: ${title} | Autores: ${authors} | Año: ${year} | Editorial: ${publisher} | DOI: ${doi} | Páginas: ${pages}`;
}

async function searchAcademicData(query) {
  if (isBunkerMode()) {
    return '';
  }

  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&select=title,author,issued,DOI,publisher,page&rows=3`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AsistenteAcademico/1.0 (academic-writing-tool; mailto:academico@localhost)',
        Accept: 'application/json',
      },
    });
    if (!response.ok) return '';

    const data = await response.json();
    const items = data?.message?.items || [];
    if (!items.length) return '';

    return items
      .map((item, index) => `${index + 1}. ${formatCrossrefWork(item)}`)
      .join('\n');
  } catch {
    return '';
  }
}

async function buildAcademicContextBlock(inputText) {
  const queries = extractCitationQueries(inputText);
  if (!queries.length) return '';

  const lookupResults = await Promise.all(
    queries.map(async (query) => {
      const localHits = searchBibliotecaLocal(query, 2);
      const localPart = formatLocalBibliotecaHits(query, localHits);
      const crossref = await searchAcademicData(query);
      const crossrefPart = crossref ? `Consulta "${query}" — Crossref:\n${crossref}` : '';

      if (localPart && crossrefPart) {
        return `${localPart}\n\n${crossrefPart}`;
      }
      return localPart || crossrefPart || '';
    })
  );

  const condensed = lookupResults.filter(Boolean).join('\n\n');
  if (!condensed) return '';

  return `[Academic Context — biblioteca local prioritaria + Crossref]\n${condensed}`;
}

function buildSessionContextBlock(sessionContext) {
  if (!sessionContext || !sessionContext.previousChapters?.length) return '';

  const lines = [
    '[Session Context — Memoria de la sesión de escritura]',
    `Proyecto: "${sessionContext.sessionName || 'Sin nombre'}"`,
    `Capítulos ya corregidos en esta sesión: ${sessionContext.chapterCount || sessionContext.previousChapters.length}`,
    '',
    'MANTENÉ coherencia de tono académico, terminología, voz, nivel de registro y formato de citas con los fragmentos previos.',
    'El texto nuevo debe leerse como continuación del mismo trabajo, no como un documento independiente.',
    '',
  ];

  sessionContext.previousChapters.forEach((chapter, index) => {
    lines.push(`--- Capítulo previo ${index + 1}: ${chapter.title} ---`);
    if (chapter.optimizedExcerpt) {
      lines.push(`Texto ya optimizado (extracto representativo):\n${chapter.optimizedExcerpt}`);
    }
    if (chapter.auditSummary) {
      lines.push(`Criterios de corrección ya aplicados:\n${chapter.auditSummary}`);
    }
    lines.push('');
  });

  lines.push('INSTRUCCIÓN: Aplicá los mismos criterios editoriales y convenciones normativas que en los capítulos anteriores, salvo corrección de errores objetivos.');

  return lines.join('\n');
}

async function buildContextualizedUserText(inputText, norma, nivel, sessionContext = null) {
  const normaVal = sessionContext?.norma || norma || 'APA 7ª ed.';
  const nivelVal = sessionContext?.nivel || nivel || 'Trabajo de Grado';
  const academicBlock = await buildAcademicContextBlock(inputText);
  const academicPart = academicBlock ? `\n\n${academicBlock}` : '';
  const sessionPart = buildSessionContextBlock(sessionContext);
  const sessionBlock = sessionPart ? `\n\n${sessionPart}` : '';
  return `[Contexto: El usuario está escribiendo un/a ${nivelVal} usando normas ${normaVal}]${sessionBlock}${academicPart}\n\n${inputText}`;
}

async function buildRewriteUserText(inputText, norma, nivel, auditReport, sessionContext = null) {
  const contextualized = await buildContextualizedUserText(inputText, norma, nivel, sessionContext);
  return `${contextualized}\n\n--- INFORME DE AUDITORÍA (FASE 1) ---\n${auditReport}\n\n--- FIN INFORME ---\n\nReescribí el texto aplicando las correcciones del informe e incluí la sección ### Referencias Bibliográficas al final.`;
}

async function buildAllowedCitationsForIntegrity(inputText, sessionContext = null) {
  const citations = extractCitations(inputText).map((item) => item.raw);
  const queries = extractCitationQueries(inputText);
  if (!queries.length) return citations;

  const lookupResults = await Promise.all(
    queries.map(async (query) => {
      const localHits = searchBibliotecaLocal(query, 2);
      const localPart = formatLocalBibliotecaHits(query, localHits);
      const crossref = await searchAcademicData(query);
      return [localPart, crossref].filter(Boolean).join('\n');
    })
  );

  const contextBlob = lookupResults.join('\n');
  const yearMatches = contextBlob.match(/\b(19|20)\d{2}[a-z]?\b/g) || [];
  for (const query of queries) {
    const surname = query.split(',')[0]?.trim();
    const year = (query.match(/\d{4}[a-z]?/) || [])[0];
    if (surname && year) citations.push(`${surname}, ${year}`);
    for (const yr of yearMatches) {
      citations.push(`${surname}, ${yr}`);
    }
  }

  return [...new Set(citations)];
}

async function runAuditStage(inputText, norma, nivel, sessionContext = null) {
  const contextualizedText = await buildContextualizedUserText(inputText, norma, nivel, sessionContext);
  const { content: auditRaw, modelUsed } = await callLlm(AUDIT_SYSTEM_PROMPT_JSON, contextualizedText, {
    maxTokens: LLM_MAX_TOKENS_AUDIT,
    jsonMode: true,
  });
  return { ...extractAuditJSON(auditRaw, inputText), modelUsed };
}

async function runRewriteStage(inputText, norma, nivel, auditResult, sessionContext = null) {
  const auditReport = typeof auditResult === 'string'
    ? auditResult
    : formatAuditForRewrite(auditResult?.auditJson, auditResult?.audit);
  const userText = await buildRewriteUserText(inputText, norma, nivel, auditReport, sessionContext);
  const { content: optimizedRaw, modelUsed } = await callLlm(REWRITE_SYSTEM_PROMPT_V3, userText, { maxTokens: LLM_MAX_TOKENS_REWRITE });
  const allowedCitations = await buildAllowedCitationsForIntegrity(inputText, sessionContext);
  const integrityResult = verifyRewriteIntegrity(inputText, optimizedRaw, { allowedCitations });

  return {
    optimizedText: integrityResult.sanitizedOptimized,
    modelUsed,
    integrity: {
      ok: integrityResult.ok,
      citas_perdidas: integrityResult.citas_perdidas,
      citas_inventadas: integrityResult.citas_inventadas,
      citas_alteradas: integrityResult.citas_alteradas,
      datos_alterados: integrityResult.datos_alterados,
    },
  };
}

function buildAuditApiPayload(auditResult) {
  return {
    audit: auditResult.audit,
    auditJson: auditResult.auditJson,
    auditMode: auditResult.auditMode,
    auditRaw: auditResult.auditRaw,
  };
}

function recordSuggestUsage(sessionId, stage, charCount, model, sessionChapterCount = 0) {
  if (!sessionId) return null;

  const costUsd = estimateStageCostUsd(charCount, model, stage, { sessionChapters: sessionChapterCount });
  return recordSessionUsage(sessionId, {
    stage,
    costUsd,
    charCount,
    model,
  });
}

const configSaveSchema = Joi.object({
  provider: Joi.string()
    .trim()
    .valid(...LLM_PROVIDER_IDS)
    .required()
    .messages({
      'any.only': 'Proveedor de IA no válido.',
      'any.required': 'Debe seleccionar un proveedor de IA.',
    }),
  apiKey: Joi.string().trim().allow('').max(500).optional(),
  apiKeys: Joi.object()
    .pattern(Joi.string().valid(...LLM_PROVIDER_IDS), Joi.string().trim().allow('').max(500))
    .optional(),
  model: Joi.string()
    .trim()
    .min(1)
    .max(300)
    .required()
    .messages({
      'string.empty': 'El modelo no puede estar vacío.',
      'string.max': 'El identificador del modelo es demasiado largo.',
      'any.required': 'El modelo es obligatorio.',
    }),
  openRouterModel: Joi.string().trim().min(1).max(300).optional(),
  openRouterApiKey: Joi.string().trim().allow('').max(500).optional(),
  baseUrl: Joi.string().trim().allow('').max(500).optional(),
  fastModel: Joi.string().trim().allow('').max(300).optional(),
  fastModels: Joi.object()
    .pattern(Joi.string().valid(...LLM_PROVIDER_IDS), Joi.string().trim().allow('').max(300))
    .optional(),
  costConfirmThresholdUsd: Joi.number().min(0).max(100).optional(),
  bunkerMode: Joi.boolean().optional(),
}).options({ stripUnknown: true });

const estimateSchema = Joi.object({
  text: Joi.string().trim().min(1).max(5000000).required(),
  sessionId: Joi.string().uuid().optional(),
}).options({ stripUnknown: true });

const exportDocxSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  title: Joi.string().trim().max(200).allow('').optional(),
  author: Joi.string().trim().max(120).allow('').optional(),
  authorLastName: Joi.string().trim().max(80).allow('').optional(),
}).options({ stripUnknown: true });

const suggestSchema = Joi.object({
  text: Joi.string()
    .min(1)
    .max(5000000)
    .required()
    .messages({
      'string.base': 'El campo "text" debe ser una cadena de texto.',
      'string.empty': 'El campo "text" no puede estar vacío.',
      'string.min': 'El texto debe tener al menos 1 carácter.',
      'string.max': 'El texto excede el límite máximo de 5,000,000 caracteres.',
      'any.required': 'El campo "text" es obligatorio.',
    }),
  norma: Joi.string()
    .valid(...NORMATIVA_OPTIONS)
    .optional()
    .messages({
      'any.only': 'La normativa seleccionada no es válida.',
    }),
  nivel: Joi.string()
    .valid(...NIVEL_OPTIONS)
    .optional()
    .messages({
      'any.only': 'El nivel académico seleccionado no es válido.',
    }),
  stage: Joi.string().valid('audit', 'rewrite', 'full').optional(),
  audit: Joi.string().trim().min(1).max(5000000).optional(),
  auditJson: Joi.object().optional(),
  acceptedSuggestions: Joi.array().items(Joi.string().trim()).optional(),
  sessionId: Joi.string().uuid().optional(),
  costConfirmed: Joi.boolean().optional(),
  guardianModel: Joi.string().trim().max(300).allow('').optional(),
}).options({ stripUnknown: true });

const sessionCreateSchema = Joi.object({
  name: Joi.string().trim().max(120).allow('').optional(),
  norma: Joi.string().valid(...NORMATIVA_OPTIONS).optional(),
  nivel: Joi.string().valid(...NIVEL_OPTIONS).optional(),
  seedText: Joi.string().trim().max(5000000).allow('').optional(),
}).options({ stripUnknown: true });

const sessionUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).optional(),
  norma: Joi.string().valid(...NORMATIVA_OPTIONS).optional(),
  nivel: Joi.string().valid(...NIVEL_OPTIONS).optional(),
}).options({ stripUnknown: true });

const chapterCreateSchema = Joi.object({
  originalText: Joi.string().trim().min(1).max(5000000).required(),
  audit: Joi.string().trim().min(1).max(5000000).required(),
  auditJson: Joi.object().allow(null).optional(),
  optimizedText: Joi.string().trim().min(1).max(5000000).required(),
  title: Joi.string().trim().max(120).allow('').optional(),
  headingLevel: Joi.number().integer().valid(0, 1, 2).optional(),
  isChapterStart: Joi.boolean().optional(),
  chapterTitle: Joi.string().trim().max(120).allow('').optional(),
  modelUsed: Joi.string().trim().max(120).allow('').optional(),
  norma: Joi.string().valid(...NORMATIVA_OPTIONS).optional(),
  nivel: Joi.string().valid(...NIVEL_OPTIONS).optional(),
}).options({ stripUnknown: true });

const chapterRenameSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).required(),
}).options({ stripUnknown: true });

const chapterOrderSchema = Joi.object({
  order: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
}).options({ stripUnknown: true });

app.get('/api/config', (req, res) => {
  const providerId = getLlmProviderId();
  const provider = getLlmProvider(providerId);
  const apiKey = getLlmApiKey(providerId);
  const model = getLlmModel(providerId);
  const baseUrl = getLlmBaseUrl(providerId);
  const maskedKeys = getMaskedKeysForAllProviders();
  const savedModels = loadLlmModelsStore();
  const savedFastModels = loadLlmFastModelsStore();
  const savedBaseUrls = loadLlmBaseUrlsStore();
  const fastModel = getLlmFastModel(providerId);

  res.json({
    configured: isLlmConfigured(),
    maskedKey: maskApiKey(apiKey),
    maskedKeys,
    savedModels,
    savedFastModels,
    savedBaseUrls,
    provider: providerId,
    providerLabel: provider.label,
    model,
    fastModel,
    costConfirmThresholdUsd: getCostConfirmThreshold(),
    bunkerMode: isBunkerMode(),
    bindHost: getBindHost(),
    baseUrl,
    defaultModel: provider.defaultModel,
    keyOptional: provider.keyOptional,
    docsUrl: provider.docsUrl,
    providers: LLM_PROVIDER_IDS.map((id) => {
      const p = getLlmProvider(id);
      return {
        id,
        label: p.label,
        defaultModel: p.defaultModel,
        keyOptional: p.keyOptional,
        docsUrl: p.docsUrl,
        hasKey: p.keyOptional ? true : Boolean(getLlmApiKey(id)),
        maskedKey: maskedKeys[id],
        savedModel: savedModels[id] || p.defaultModel,
        configured: isProviderConfigured(id),
      };
    }),
  });
});

function normalizeConfigPayload(body = {}) {
  const payload = { ...body };

  if (!payload.model?.trim() && payload.openRouterModel?.trim()) {
    payload.model = payload.openRouterModel.trim();
  }

  if (!payload.provider?.trim()) {
    payload.provider = 'openrouter';
  }

  if (payload.openRouterApiKey?.trim()) {
    payload.apiKeys = { ...(payload.apiKeys || {}), openrouter: payload.openRouterApiKey.trim() };
    if (!payload.apiKey?.trim()) {
      payload.apiKey = payload.openRouterApiKey.trim();
    }
  }

  return payload;
}

app.post('/api/config', asyncHandler(async (req, res) => {
  const normalizedBody = normalizeConfigPayload(req.body);
  const { error, value } = configSaveSchema.validate(normalizedBody);

  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const provider = getLlmProvider(value.provider);
  const keys = loadLlmKeysStore();
  const models = loadLlmModelsStore();
  const fastModels = loadLlmFastModelsStore();
  const baseUrls = loadLlmBaseUrlsStore();

  if (value.apiKeys && typeof value.apiKeys === 'object') {
    for (const [providerId, keyValue] of Object.entries(value.apiKeys)) {
      if (keyValue && keyValue.trim()) {
        keys[providerId] = keyValue.trim();
      }
    }
  }

  const singleKey = value.apiKey?.trim() || '';
  if (singleKey) {
    keys[value.provider] = singleKey;
  }

  const existingKey = getLlmApiKey(value.provider);
  const hasKeyForProvider = Boolean(keys[value.provider] || existingKey);

  if (!provider.keyOptional && !hasKeyForProvider) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: [`Ingresá una API Key de ${provider.label} (en el banco de keys o para el proveedor activo).`],
    });
  }

  const nextBaseUrl = value.baseUrl?.trim() || baseUrls[value.provider] || '';
  if ((value.provider === 'local' || value.provider === 'custom' || value.provider === 'azure') && !nextBaseUrl) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: ['La URL base es obligatoria para Local, Custom o Azure OpenAI.'],
    });
  }

  try {
    models[value.provider] = value.model;
    if (value.baseUrl?.trim()) {
      baseUrls[value.provider] = value.baseUrl.trim();
    }

    if (value.fastModels && typeof value.fastModels === 'object') {
      for (const [providerId, fastValue] of Object.entries(value.fastModels)) {
        if (fastValue && fastValue.trim()) {
          fastModels[providerId] = fastValue.trim();
        }
      }
    }
    if (value.fastModel?.trim()) {
      fastModels[value.provider] = value.fastModel.trim();
    }

    saveJsonEnvVariable('LLM_KEYS_JSON', keys);
    saveJsonEnvVariable('LLM_MODELS_JSON', models);
    saveJsonEnvVariable('LLM_FAST_MODELS_JSON', fastModels);
    saveJsonEnvVariable('LLM_BASE_URLS_JSON', baseUrls);

    saveEnvVariable('LLM_PROVIDER', value.provider);
    CONFIG.LLM_PROVIDER = value.provider;

    saveEnvVariable('LLM_MODEL', value.model);
    CONFIG.LLM_MODEL = value.model;

    const activeKey = keys[value.provider] || existingKey;
    if (activeKey) {
      saveEnvVariable('LLM_API_KEY', activeKey);
      CONFIG.LLM_API_KEY = activeKey;
    }

    if (nextBaseUrl) {
      saveEnvVariable('LLM_BASE_URL', nextBaseUrl);
      CONFIG.LLM_BASE_URL = nextBaseUrl;
    }

    if (keys.openrouter) {
      saveEnvVariable('OPENROUTER_API_KEY', keys.openrouter);
    }
    if (models.openrouter) {
      saveEnvVariable('OPENROUTER_MODEL', models.openrouter);
    }

    if (typeof value.costConfirmThresholdUsd === 'number') {
      saveEnvVariable('COST_CONFIRM_THRESHOLD_USD', String(value.costConfirmThresholdUsd));
      CONFIG.COST_CONFIRM_THRESHOLD_USD = String(value.costConfirmThresholdUsd);
    }

    if (typeof value.bunkerMode === 'boolean') {
      saveEnvVariable('BUNKER_MODE', value.bunkerMode ? 'true' : 'false');
      CONFIG.BUNKER_MODE = value.bunkerMode ? 'true' : 'false';
    }

    const maskedKeys = getMaskedKeysForAllProviders();

    return res.json({
      success: true,
      message: 'Configuración guardada correctamente en .env',
      configured: isLlmConfigured(),
      maskedKey: maskApiKey(activeKey),
      maskedKeys,
      savedModels: models,
      savedFastModels: fastModels,
      savedBaseUrls: baseUrls,
      provider: value.provider,
      providerLabel: provider.label,
      model: value.model,
      fastModel: getLlmFastModel(value.provider),
      costConfirmThresholdUsd: getCostConfirmThreshold(),
      bunkerMode: isBunkerMode(),
      baseUrl: nextBaseUrl,
    });
  } catch (writeErr) {
    console.error('[api/config] Error al escribir .env:', writeErr);
    return res.status(500).json({
      error: 'No se pudo guardar la configuración',
      details: writeErr.message,
    });
  }
}));

app.post('/api/estimate', asyncHandler(async (req, res) => {
  const { error, value } = estimateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const model = getLlmModel();
  let sessionChapters = 0;
  if (value.sessionId) {
    const session = getSession(value.sessionId);
    if (session?.chapters) sessionChapters = session.chapters.length;
  }

  const estimateUsd = estimateCostUsd(value.text.length, model, { sessionChapters });
  const thresholdUsd = getCostConfirmThreshold();

  return res.json({
    estimateUsd,
    thresholdUsd,
    requiresConfirmation: estimateUsd > thresholdUsd,
    model,
    fastModel: getLlmFastModel(),
    charCount: value.text.length,
  });
}));

app.get('/api/biblioteca/status', asyncHandler(async (req, res) => {
  return res.json(getBibliotecaStatus());
}));

app.post('/api/biblioteca/reindex', asyncHandler(async (req, res) => {
  const index = await rebuildBibliotecaIndex();
  return res.json({
    success: true,
    chunkCount: index.chunks.length,
    updatedAt: index.updatedAt,
    files: getBibliotecaStatus().files,
  });
}));

app.post('/api/export/docx', asyncHandler(async (req, res) => {
  const { error, value } = exportDocxSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const session = getSession(value.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  if (!session.chapters?.length) {
    return res.status(400).json({
      error: 'La sesión no tiene capítulos para exportar',
      details: 'Corregí al menos un fragmento antes de generar el Word.',
    });
  }

  const result = await exportDocxEntregable({
    session,
    norma: session.norma,
    title: value.title || session.name,
    author: value.author || 'Autor',
    authorLastName: value.authorLastName || '',
    sessionName: session.name,
  });

  return res.json({
    success: true,
    filename: result.filename,
    downloadUrl: result.downloadUrl,
    bytes: result.bytes,
    norma: session.norma,
  });
}));

app.post('/api/export/pdf', asyncHandler(async (req, res) => {
  const { error, value } = exportDocxSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const session = getSession(value.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  if (!session.chapters?.length) {
    return res.status(400).json({
      error: 'La sesión no tiene fragmentos para exportar',
      details: 'Corregí al menos un fragmento antes de generar el PDF.',
    });
  }

  const result = await exportPdfEntregable({
    session,
    norma: session.norma,
    title: value.title || session.name,
    author: value.author || 'Autor',
    sessionName: session.name,
  });

  return res.json({
    success: true,
    filename: result.filename,
    downloadUrl: result.downloadUrl,
    bytes: result.bytes,
    norma: session.norma,
  });
}));

app.get('/api/entregables/:filename', asyncHandler(async (req, res) => {
  const filePath = safeEntregablePath(req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  return res.download(filePath, path.basename(filePath));
}));

app.get('/api/sessions', asyncHandler(async (req, res) => {
  res.json({ sessions: listSessions() });
}));

app.post('/api/sessions', asyncHandler(async (req, res) => {
  const { error, value } = sessionCreateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const session = createSession(value);
  return res.status(201).json({ session });
}));

app.get('/api/sessions/:id', asyncHandler(async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  return res.json({ session });
}));

app.patch('/api/sessions/:id', asyncHandler(async (req, res) => {
  const { error, value } = sessionUpdateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const session = updateSession(req.params.id, value);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  return res.json({ session });
}));

app.delete('/api/sessions/:id', asyncHandler(async (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  return res.json({ success: true });
}));

app.post('/api/sessions/:id/chapters', asyncHandler(async (req, res) => {
  const { error, value } = chapterCreateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  try {
    const result = addChapter(req.params.id, value);
    if (!result) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    return res.status(201).json(result);
  } catch (chapterErr) {
    return res.status(400).json({
      error: 'No se pudo guardar el capítulo',
      details: chapterErr.message,
    });
  }
}));

app.delete('/api/sessions/:id/chapters/:chapterId', asyncHandler(async (req, res) => {
  const session = deleteChapter(req.params.id, req.params.chapterId);
  if (!session) {
    return res.status(404).json({ error: 'Sesión o capítulo no encontrado' });
  }
  return res.json({ session });
}));

app.patch('/api/sessions/:id/chapters/:chapterId', asyncHandler(async (req, res) => {
  const { error, value } = chapterRenameSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  const session = renameChapter(req.params.id, req.params.chapterId, value.title);
  if (!session) {
    return res.status(404).json({ error: 'Sesión o fragmento no encontrado' });
  }
  return res.json({ session });
}));

app.put('/api/sessions/:id/chapters/order', asyncHandler(async (req, res) => {
  const { error, value } = chapterOrderSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validación fallida',
      details: error.details.map((d) => d.message),
    });
  }

  try {
    const session = reorderChapters(req.params.id, value.order);
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    return res.json({ session });
  } catch (orderErr) {
    return res.status(400).json({
      error: 'Orden de fragmentos inválido',
      details: orderErr.message,
    });
  }
}));

app.post('/api/suggest', asyncHandler(async (req, res) => {
  try {
    const { error, value } = suggestSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        error: 'Validación fallida',
        details: error.details.map((d) => d.message),
      });
    }

    const inputText = value.text.trim();
    let norma = value.norma || 'APA 7ª ed.';
    let nivel = value.nivel || 'Trabajo de Grado';
    const stage = value.stage || 'full';
    const provider = getLlmProvider(getLlmProviderId());
    const mainModel = getLlmModel();
    const guardianModel = String(value.guardianModel || '').trim() || getLlmFastModel();
    console.log(`[api/suggest] Proveedor LLM: ${provider.label} · Modelo Principal: ${mainModel || '(sin configurar)'} · Guardián: ${guardianModel || '(fallback al principal)'}`);

    let sessionContext = null;
    if (value.sessionId) {
      const session = getSession(value.sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'Sesión no encontrada',
          details: 'La sesión indicada no existe o fue eliminada.',
        });
      }
      norma = norma || session.norma;
      nivel = nivel || session.nivel;
      sessionContext = buildSessionContextForLlm(session);
      if (sessionContext) {
        console.log(`[api/suggest] Sesión "${session.name}" · ${session.chapters.length} capítulo(s) previo(s)`);
      }
    }

    if (await containsEvasionIntent(inputText, guardianModel)) {
      console.log('[api/suggest] Intención de evasión bloqueada (guardián)');
      return res.json({
        redirect: true,
        message: 'Por favor, enfócate en aprender de forma honesta. Puedo ayudarte a mejorar tu escritura siguiendo normas académicas (APA, MLA, Chicago) y principios de comunicación clara.',
        blockedBy: 'guardian',
      });
    }

    const sessionChapterCount = value.sessionId
      ? (getSession(value.sessionId)?.chapters?.length || 0)
      : 0;
    const estimateUsd = estimateCostUsd(inputText.length, getLlmModel(), { sessionChapters: sessionChapterCount });
    const thresholdUsd = getCostConfirmThreshold();

    if (stage === 'audit' && estimateUsd > thresholdUsd && !value.costConfirmed) {
      return res.status(402).json({
        error: 'Confirmación de costo requerida',
        details: `El análisis estimado cuesta ~USD ${estimateUsd.toFixed(4)} (umbral: USD ${thresholdUsd.toFixed(2)}).`,
        estimateUsd,
        thresholdUsd,
        requiresConfirmation: true,
      });
    }

    const citationQueries = extractCitationQueries(inputText);
    if (citationQueries.length) {
      console.log(`[api/suggest] Crossref lookup · ${citationQueries.length} cita(s): ${citationQueries.join(', ')}`);
    }

    if (stage === 'audit') {
      console.log(`[api/suggest] Fase 1 (Auditoría JSON) · ${provider.label} · ${getLlmModel()}`);
      const auditResult = await runAuditStage(inputText, norma, nivel, sessionContext);
      const usage = recordSuggestUsage(
        value.sessionId,
        'audit',
        inputText.length,
        getLlmModel(),
        sessionChapterCount
      );
      return res.json({
        redirect: false,
        stage: 'audit',
        ...buildAuditApiPayload(auditResult),
        modelUsed: auditResult.modelUsed || getLlmModel(),
        norma,
        nivel,
        sessionId: value.sessionId || null,
        provider: getLlmProviderId(),
        providerLabel: provider.label,
        usage,
        bunkerMode: isBunkerMode(),
      });
    }

    if (stage === 'rewrite') {
      if (!value.audit || !value.audit.trim()) {
        return res.status(400).json({
          error: 'Validación fallida',
          details: ['Se requiere el informe de auditoría (audit) para la fase de reescritura.'],
        });
      }
      console.log(`[api/suggest] Fase 2 (Reescritura) · ${provider.label} · ${getLlmModel()}`);
      let auditResult = value.auditJson
        ? { auditJson: value.auditJson, audit: value.audit.trim(), auditMode: 'json' }
        : value.audit.trim();

      if (value.auditJson && Array.isArray(value.acceptedSuggestions) && value.acceptedSuggestions.length) {
        const filteredJson = filterAcceptedSuggestions(value.auditJson, value.acceptedSuggestions);
        auditResult = {
          auditJson: filteredJson,
          audit: formatAuditForRewrite(filteredJson),
          auditMode: 'json',
        };
      }

      const rewriteResult = await runRewriteStage(inputText, norma, nivel, auditResult, sessionContext);
      const usage = recordSuggestUsage(
        value.sessionId,
        'rewrite',
        inputText.length,
        getLlmModel(),
        sessionChapterCount
      );
      return res.json({
        redirect: false,
        stage: 'rewrite',
        optimizedText: rewriteResult.optimizedText,
        integrity: rewriteResult.integrity,
        modelUsed: rewriteResult.modelUsed || getLlmModel(),
        norma,
        nivel,
        sessionId: value.sessionId || null,
        provider: getLlmProviderId(),
        providerLabel: provider.label,
        usage,
        bunkerMode: isBunkerMode(),
      });
    }

    console.log(`[api/suggest] Análisis completo (2 etapas) · ${provider.label} · ${getLlmModel()}`);
    const auditResult = await runAuditStage(inputText, norma, nivel, sessionContext);
    const rewriteResult = await runRewriteStage(inputText, norma, nivel, auditResult, sessionContext);
    const usage = recordSuggestUsage(
      value.sessionId,
      'full',
      inputText.length,
      getLlmModel(),
      sessionChapterCount
    );

    return res.json({
      redirect: false,
      stage: 'full',
      ...buildAuditApiPayload(auditResult),
      optimizedText: rewriteResult.optimizedText,
      integrity: rewriteResult.integrity,
      modelUsed: rewriteResult.modelUsed || getLlmModel(),
      auditModelUsed: auditResult.modelUsed || getLlmModel(),
      original: inputText,
      suggested: rewriteResult.optimizedText,
      suggestion: auditResult.audit,
      norma,
      nivel,
      sessionId: value.sessionId || null,
      provider: getLlmProviderId(),
      providerLabel: provider.label,
      usage,
      bunkerMode: isBunkerMode(),
      explanation: 'Análisis en dos etapas (Auditoría JSON + Reescritura) con System Prompt v3.1.',
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`[api/suggest] ${err.statusCode}:`, err.message, err.details || '');
      return res.status(err.statusCode).json({
        error: err.message,
        details: err.details,
        retryable: Boolean(err.retryable),
        retryAfterMs: err.retryAfterMs ?? null,
      });
    }

    console.error('[api/suggest] Error inesperado:', err);
    return res.status(500).json({
      error: 'Error interno al procesar la solicitud',
      details: err.message,
    });
  }
}));

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'JSON inválido en el cuerpo de la petición',
      details: err.message,
    });
  }

  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'El documento es demasiado grande',
      details: 'El límite actual del servidor es 50 MB. Intentá dividir el texto o subir un archivo más liviano.',
    });
  }

  console.error('[global]', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    details: err.message,
  });
});

if (require.main === module) {
  const bindHost = getBindHost();
  app.listen(PORT, bindHost, () => {
    const provider = getLlmProvider(getLlmProviderId());
    const configured = isLlmConfigured();
    console.log(`Servidor escuchando en http://${bindHost}:${PORT}`);
    console.log(`Proveedor LLM: ${provider.label} · Modelo: ${getLlmModel() || '(sin configurar)'}`);
    console.log(`Guardián (modelo económico): ${getLlmFastModel() || '(fallback al principal)'}`);
    if (isBunkerMode()) {
      console.log('Modo Búnker: ACTIVO — sin Crossref ni endpoints remotos');
    }
    if (!configured) {
      console.warn('ADVERTENCIA: Proveedor LLM no configurado. Configuralo desde ⚙️ en el frontend.');
    }
  });
}

module.exports = {
  app,
  SYSTEM_PROMPT_V2_3,
  ApiError,
  searchAcademicData,
  extractCitationQueries,
  buildSessionContextBlock,
  extractAuditJSON,
  sanitizeZeroWidth,
  classifyIntent,
  classifyIntentLLM,
  containsEvasionIntent,
  estimateCostUsd,
  estimateStageCostUsd,
  getLlmFastModel,
  getBindHost,
  isBunkerMode,
  isLocalhostEndpoint,
  recordSuggestUsage,
  callLlmOnce,
};