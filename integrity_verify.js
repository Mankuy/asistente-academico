const { sanitizeZeroWidth } = require('./audit_json');

const HOMOGLYPH_REPLACEMENTS = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c',
  '\u0443': 'y', '\u0445': 'x', '\u0410': 'A', '\u0415': 'E', '\u041e': 'O',
  '\u0420': 'P', '\u0421': 'C', '\u0423': 'Y', '\u0425': 'X',
};

const CITATION_PAREN_RE = /\(([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]*,?\s*\d{4}[a-z]?)\)/g;
const CITATION_NARRATIVE_RE = /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,50}?)\s+\((\d{4}[a-z]?)\)/g;
const LAW_RE = /\bLey\s+(?:N[°º.]?\s*)?(\d[\d.]*)/gi;
const PERCENT_RE = /\b(\d{1,3}(?:[.,]\d+)?)\s*%/g;
const YEAR_RE = /\b(19|20)\d{2}[a-z]?\b/g;
const MULTI_DIGIT_RE = /\b(\d{2,}(?:[.,]\d+)?)\b/g;
const REFERENCES_MARKER = /###\s*Referencias Bibliográficas/i;

function stripHomoglyphs(text) {
  let out = String(text || '');
  for (const [from, to] of Object.entries(HOMOGLYPH_REPLACEMENTS)) {
    out = out.split(from).join(to);
  }
  return out;
}

function sanitizeOptimizedText(text) {
  return stripHomoglyphs(sanitizeZeroWidth(String(text || '')));
}

function normalizeMatchText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019\u201C\u201D«»]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitBodyAndReferences(text) {
  const raw = String(text || '');
  const match = raw.match(REFERENCES_MARKER);
  if (!match) return { body: raw.trim(), references: '' };
  const idx = match.index;
  return {
    body: raw.slice(0, idx).trim(),
    references: raw.slice(idx).trim(),
  };
}

function parseCitationKey(raw) {
  const cleaned = String(raw || '').trim();
  const parenMatch = cleaned.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]*?)\s*,\s*(\d{4}[a-z]?)$/);
  if (parenMatch) {
    const surname = parenMatch[1].trim().split(/\s+/).pop().replace(/[.,]/g, '');
    return { surname: surname.toLowerCase(), year: parenMatch[2].toLowerCase(), raw: cleaned };
  }
  return null;
}

function extractCitations(text) {
  const found = [];
  const seen = new Set();

  const add = (raw) => {
    const parsed = parseCitationKey(raw);
    if (!parsed) return;
    const key = `${parsed.surname}|${parsed.year}|${parsed.raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(parsed);
  };

  const parenRe = new RegExp(CITATION_PAREN_RE.source, 'g');
  let m;
  while ((m = parenRe.exec(text)) !== null) add(m[1]);

  const narrativeRe = new RegExp(CITATION_NARRATIVE_RE.source, 'g');
  while ((m = narrativeRe.exec(text)) !== null) {
    add(`${m[1].trim()}, ${m[2]}`);
  }

  return found;
}

function extractSignificantData(text) {
  const body = splitBodyAndReferences(text).body;
  const items = [];
  const seen = new Set();

  const push = (type, value, raw) => {
    const key = `${type}|${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ type, value, raw: raw || value });
  };

  let m;
  const lawRe = new RegExp(LAW_RE.source, 'gi');
  while ((m = lawRe.exec(body)) !== null) push('ley', m[1].replace(/\./g, ''), m[0]);

  const pctRe = new RegExp(PERCENT_RE.source, 'g');
  while ((m = pctRe.exec(body)) !== null) push('porcentaje', m[1].replace(',', '.'), m[0]);

  const yearRe = new RegExp(YEAR_RE.source, 'g');
  while ((m = yearRe.exec(body)) !== null) push('año', m[0].toLowerCase(), m[0]);

  const numRe = new RegExp(MULTI_DIGIT_RE.source, 'g');
  while ((m = numRe.exec(body)) !== null) {
    const val = m[1].replace(',', '.');
    if (/^(19|20)\d{2}$/.test(val.split('.')[0])) continue;
    push('cifra', val, m[0]);
  }

  return items;
}

function citationKeysBySurname(citations) {
  const map = new Map();
  for (const c of citations) {
    if (!map.has(c.surname)) map.set(c.surname, []);
    map.get(c.surname).push(c);
  }
  return map;
}

function buildAllowedCitationSet(allowedCitations = []) {
  const set = new Set();
  for (const raw of allowedCitations) {
    const parsed = parseCitationKey(raw);
    if (parsed) set.add(`${parsed.surname}|${parsed.year}`);
  }
  return set;
}

function verifyRewriteIntegrity(originalText, optimizedText, options = {}) {
  const originalBody = splitBodyAndReferences(originalText).body;
  const sanitizedOptimized = sanitizeOptimizedText(optimizedText);
  const { body: optimizedBody } = splitBodyAndReferences(sanitizedOptimized);

  const origCitations = extractCitations(originalBody);
  const optCitations = extractCitations(optimizedBody);
  const allowedSet = buildAllowedCitationSet(options.allowedCitations || []);

  const optKeys = new Set(optCitations.map((c) => `${c.surname}|${c.year}`));

  const citas_perdidas = origCitations
    .filter((c) => !optKeys.has(`${c.surname}|${c.year}`))
    .map((c) => c.raw);

  const origKeys = new Set(origCitations.map((c) => `${c.surname}|${c.year}`));
  const citas_inventadas = optCitations
    .filter((c) => {
      const key = `${c.surname}|${c.year}`;
      return !origKeys.has(key) && !allowedSet.has(key);
    })
    .map((c) => c.raw);

  const origBySurname = citationKeysBySurname(origCitations);
  const optBySurname = citationKeysBySurname(optCitations);
  const citas_alteradas = [];

  for (const [surname, origList] of origBySurname.entries()) {
    const optList = optBySurname.get(surname) || [];
    const origYears = new Set(origList.map((c) => c.year));
    const optYears = new Set(optList.map((c) => c.year));
    if (optList.length && [...origYears].some((y) => !optYears.has(y))) {
      citas_alteradas.push({
        apellido: surname,
        original: origList.map((c) => c.year).join(', '),
        optimizado: optList.map((c) => c.year).join(', '),
      });
    }
  }

  const origData = extractSignificantData(originalBody);
  const optData = extractSignificantData(optimizedBody);
  const optDataValues = new Set(optData.map((d) => `${d.type}|${d.value}`));

  const datos_alterados = origData
    .filter((d) => !optDataValues.has(`${d.type}|${d.value}`))
    .map((d) => ({ tipo: d.type, valor: d.value, raw: d.raw }));

  const ok = citas_perdidas.length === 0
    && citas_inventadas.length === 0
    && citas_alteradas.length === 0
    && datos_alterados.length === 0;

  return {
    ok,
    citas_perdidas,
    citas_inventadas,
    citas_alteradas,
    datos_alterados,
    sanitizedOptimized,
  };
}

module.exports = {
  sanitizeOptimizedText,
  stripHomoglyphs,
  extractCitations,
  extractSignificantData,
  verifyRewriteIntegrity,
  splitBodyAndReferences,
};