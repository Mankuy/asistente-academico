const LEET_MAP = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
};

const EVASION_PATTERNS = [
  /\bevad(?:ir|iendo|as?|ar)\b/i,
  /\bburlar\b/i,
  /\bturnitin\b/i,
  /\bzerogpt\b/i,
  /\bgptzero\b/i,
  /\banti.?plagio\b/i,
  /\bdetector.?(?:de|de\s+)?(?:ia|ai|plagio)\b/i,
  /\bbypass\b/i,
  /\b(?:bypass|beat|fool|trick|evade)\s+(?:the\s+)?(?:detector|detection|turnitin|plagiarism|ai|chatgpt)\b/i,
  /\bundetectable\b/i,
  /\bmake\s+it\s+undetectable\b/i,
  /\bhumaniz(?:e|ing)\s+(?:this\s+)?(?:text|essay|content|ai|writing)?\b/i,
  /\bengañar\b/i,
  /\bpasar\s+(?:por|desapercibido)\b/i,
  /\breducir\s+(?:la\s+)?(?:probabilidad|posibilidad)\s+de\s+detección\b/i,
  /\breescribir\s+para\s+(?:que\s+)?no\s+(?:sea\s+)?detectado\b/i,
  /\bavoid\s+(?:ai\s+)?detection\b/i,
  /\bpass\s+(?:the\s+)?(?:ai|plagiarism)\s+(?:check|detector)\b/i,
  /\bno\s+sea\s+detectado\b/i,
];

const ACADEMIC_HELP_PATTERNS = [
  /\bmejorar\b/i,
  /\bcorregir\b/i,
  /\bap(?:a|a\s+7|7ª?)\b/i,
  /\bml(?:a|a\s+9|9ª?)\b/i,
  /\bchicago\b/i,
  /\bparafrasear\b/i,
  /\bcitar\b/i,
  /\breferenciar\b/i,
  /\bcoherencia\b/i,
  /\bconcisión\b/i,
  /\bestructura\b/i,
  /\btesis\b/i,
  /\bargumento\b/i,
];

const MODEL_PRICE_PER_1M = {
  default: { input: 1.0, output: 3.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'openrouter/owl-alpha': { input: 0.5, output: 1.5 },
  'openrouter/free': { input: 0, output: 0 },
  'google/gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'meta/llama-3.1-70b-instruct': { input: 0.35, output: 0.41 },
  'mistral-small-latest': { input: 0.2, output: 0.6 },
  'sonar': { input: 1.0, output: 1.0 },
};

const GUARDIAN_SYSTEM_PROMPT = `Sos un clasificador de intención para un tutor de escritura académica.
Respondé ÚNICAMENTE con JSON válido: {"intent":"evasion"|"academic_help"|"unknown"}
- evasion: quiere evadir detectores de plagio/IA, humanizar para no ser detectado, burlar Turnitin, etc.
- academic_help: quiere mejorar redacción, citas, estructura o normativa académica legítima.
- unknown: no está claro.`;

function normalizeIntentText(text) {
  let normalized = String(text || '').toLowerCase().trim();
  normalized = normalized.normalize('NFD').replace(/\p{M}/gu, '');
  normalized = normalized.replace(/[013457@$]/g, (ch) => LEET_MAP[ch] || ch);
  normalized = normalized.replace(/[^\w\sáéíóúñü]/gi, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

function classifyIntentRegex(text) {
  const normalized = normalizeIntentText(text);

  for (const pattern of EVASION_PATTERNS) {
    if (pattern.test(normalized)) return 'evasion';
  }

  for (const pattern of ACADEMIC_HELP_PATTERNS) {
    if (pattern.test(normalized)) return 'academic_help';
  }

  return 'unknown';
}

function parseGuardianJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return { intent: 'unknown' };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return { intent: 'unknown' };

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    const intent = String(parsed.intent || '').toLowerCase();
    if (intent === 'evasion' || intent === 'academic_help' || intent === 'unknown') {
      return { intent };
    }
  } catch {
    /* fail-open */
  }

  if (/evasion/i.test(candidate)) return { intent: 'evasion' };
  if (/academic_help|academic/i.test(candidate)) return { intent: 'academic_help' };
  return { intent: 'unknown' };
}

function resolveModelPrice(model) {
  const key = String(model || '').trim();
  if (!key) return MODEL_PRICE_PER_1M.default;

  if (MODEL_PRICE_PER_1M[key]) return MODEL_PRICE_PER_1M[key];

  const lower = key.toLowerCase();
  for (const [name, price] of Object.entries(MODEL_PRICE_PER_1M)) {
    if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) {
      return price;
    }
  }

  if (/mini|8b|small|flash|instant|haiku/i.test(key)) {
    return { input: 0.15, output: 0.6 };
  }
  if (/70b|large|sonnet|pro|owl/i.test(key)) {
    return { input: 1.5, output: 5.0 };
  }

  return MODEL_PRICE_PER_1M.default;
}

function estimateStageCostUsd(chars, model, stage = 'full', options = {}) {
  const charCount = Math.max(0, Number(chars) || 0);
  const prices = resolveModelPrice(model);
  const inputTokens = Math.ceil(charCount / 4);
  const sessionExtra = options.sessionChapters ? Math.min(options.sessionChapters * 400, 3000) : 0;

  if (stage === 'audit') {
    const auditInput = inputTokens + 1200 + sessionExtra;
    const auditOutput = 1800;
    const cost = ((auditInput * prices.input) + (auditOutput * prices.output)) / 1_000_000;
    return Math.round(cost * 10000) / 10000;
  }

  if (stage === 'rewrite') {
    const rewriteInput = inputTokens + 2500 + sessionExtra;
    const rewriteOutput = Math.min(Math.ceil(inputTokens * 1.15), 10000);
    const cost = ((rewriteInput * prices.input) + (rewriteOutput * prices.output)) / 1_000_000;
    return Math.round(cost * 10000) / 10000;
  }

  return estimateCostUsd(chars, model, options);
}

function estimateCostUsd(chars, model, options = {}) {
  const charCount = Math.max(0, Number(chars) || 0);
  const prices = resolveModelPrice(model);
  const inputTokens = Math.ceil(charCount / 4);
  const sessionExtra = options.sessionChapters ? Math.min(options.sessionChapters * 400, 3000) : 0;
  const auditInput = inputTokens + 1200 + sessionExtra;
  const rewriteInput = inputTokens + 2500 + sessionExtra;
  const auditOutput = 1800;
  const rewriteOutput = Math.min(Math.ceil(inputTokens * 1.15), 10000);
  const totalInput = auditInput + rewriteInput;
  const totalOutput = auditOutput + rewriteOutput;
  const cost = ((totalInput * prices.input) + (totalOutput * prices.output)) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}

module.exports = {
  EVASION_PATTERNS,
  GUARDIAN_SYSTEM_PROMPT,
  MODEL_PRICE_PER_1M,
  normalizeIntentText,
  classifyIntentRegex,
  parseGuardianJson,
  estimateCostUsd,
  estimateStageCostUsd,
  resolveModelPrice,
};