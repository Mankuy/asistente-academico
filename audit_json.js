const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060\u180E\u00AD]/g;

const VALID_VERDICTS = new Set(['apto', 'apto_con_reservas', 'no_apto']);
const VALID_SEVERITIES = new Set(['CRÍTICO', 'IMPORTANTE', 'MENOR', 'CRITICO']);

function sanitizeZeroWidth(text) {
  return String(text || '').replace(ZERO_WIDTH_RE, '');
}

function stripCodeFences(text) {
  let cleaned = String(text || '').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();
  return cleaned;
}

function extractJsonSubstring(text) {
  const cleaned = stripCodeFences(sanitizeZeroWidth(text));
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function normalizeSeverity(value) {
  const raw = String(value || 'IMPORTANTE').trim().toUpperCase();
  if (raw === 'CRITICO') return 'CRÍTICO';
  if (VALID_SEVERITIES.has(raw)) return raw === 'CRITICO' ? 'CRÍTICO' : raw;
  if (/crit/i.test(raw)) return 'CRÍTICO';
  if (/menor/i.test(raw)) return 'MENOR';
  return 'IMPORTANTE';
}

function normalizeVeredicto(value) {
  const raw = String(value || 'apto_con_reservas').trim().toLowerCase();
  if (VALID_VERDICTS.has(raw)) return raw;
  if (/no/.test(raw)) return 'no_apto';
  if (/reserv/i.test(raw)) return 'apto_con_reservas';
  return 'apto_con_reservas';
}

function normalizeSuggestion(item, index) {
  if (!item || typeof item !== 'object') return null;
  const quote = sanitizeZeroWidth(item.quote || item.fragmento || item.original || '').trim();
  const replacement = sanitizeZeroWidth(item.replacement || item.correccion || item.corrección || '').trim();
  const explanation = sanitizeZeroWidth(item.explanation || item.justificacion || item.justificación || '').trim();
  const normRef = sanitizeZeroWidth(item.norm_ref || item.norma || item.norm_ref || '').trim();
  if (!quote && !replacement && !explanation) return null;

  return {
    id: String(item.id || `s${index + 1}`),
    quote: quote || '(fragmento no citado)',
    replacement: replacement || quote,
    explanation: explanation || 'Sin justificación provista.',
    norm_ref: normRef || 'Rigor académico general',
    severity: normalizeSeverity(item.severity || item.severidad),
  };
}

function normalizeAuditJson(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const sugerencias = Array.isArray(parsed.sugerencias)
    ? parsed.sugerencias.map(normalizeSuggestion).filter(Boolean)
    : [];

  const checklist = Array.isArray(parsed.checklist)
    ? parsed.checklist.map((item) => sanitizeZeroWidth(item).trim()).filter(Boolean)
    : [];

  const biblioCheck = Array.isArray(parsed.biblio_check)
    ? parsed.biblio_check.map((item) => sanitizeZeroWidth(item).trim()).filter(Boolean)
    : Array.isArray(parsed.biblioCheck)
      ? parsed.biblioCheck.map((item) => sanitizeZeroWidth(item).trim()).filter(Boolean)
      : [];

  return {
    resumen: sanitizeZeroWidth(parsed.resumen || parsed.summary || '').trim() || 'Sin resumen ejecutivo.',
    veredicto: normalizeVeredicto(parsed.veredicto || parsed.verdict),
    sugerencias,
    checklist,
    biblio_check: biblioCheck,
  };
}

function extractAuditJSON(rawText) {
  const auditRaw = sanitizeZeroWidth(String(rawText || ''));
  const jsonSlice = extractJsonSubstring(auditRaw);

  if (jsonSlice) {
    try {
      const parsed = JSON.parse(jsonSlice);
      const auditJson = normalizeAuditJson(parsed);
      if (auditJson) {
        return {
          auditMode: 'json',
          auditRaw,
          auditJson,
          audit: formatAuditProseFromJson(auditJson),
        };
      }
    } catch {
      /* fallback below */
    }
  }

  return {
    auditMode: 'prose',
    auditRaw,
    auditJson: null,
    audit: auditRaw.trim() || 'La auditoría no devolvió contenido utilizable.',
  };
}

function formatAuditProseFromJson(auditJson) {
  const lines = [
    `**Resumen ejecutivo:** ${auditJson.resumen}`,
    `**Veredicto:** ${auditJson.veredicto}`,
    '',
  ];

  if (auditJson.sugerencias.length) {
    lines.push('**Sugerencias detalladas:**');
    auditJson.sugerencias.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.severity}] ${item.quote}`);
      lines.push(`   → Corrección: ${item.replacement}`);
      lines.push(`   → Justificación (${item.norm_ref}): ${item.explanation}`);
    });
    lines.push('');
  }

  if (auditJson.checklist.length) {
    lines.push('**Checklist normativo:**');
    auditJson.checklist.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    lines.push('');
  }

  if (auditJson.biblio_check.length) {
    lines.push('**Verificación bibliográfica:**');
    auditJson.biblio_check.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  }

  return lines.join('\n').trim();
}

function formatAuditForRewrite(auditJson, auditProse = '') {
  if (!auditJson) return auditProse;
  return formatAuditProseFromJson(auditJson);
}

function filterAcceptedSuggestions(auditJson, acceptedIds) {
  if (!auditJson || !Array.isArray(auditJson.sugerencias)) return auditJson;
  const accepted = new Set(acceptedIds || []);
  return {
    ...auditJson,
    sugerencias: auditJson.sugerencias.filter((item) => accepted.has(item.id)),
  };
}

const AUDIT_JSON_SCHEMA_HINT = `{
  "resumen": "2-4 líneas con veredicto general",
  "veredicto": "apto|apto_con_reservas|no_apto",
  "sugerencias": [
    {
      "id": "s1",
      "quote": "fragmento literal del texto",
      "replacement": "corrección propuesta",
      "explanation": "justificación normativa o de rigor",
      "norm_ref": "APA 7ª / MLA 9ª / principio académico",
      "severity": "CRÍTICO|IMPORTANTE|MENOR"
    }
  ],
  "checklist": ["ítem normativo 1", "ítem normativo 2"],
  "biblio_check": ["discrepancia bibliográfica si aplica"]
}`;

module.exports = {
  ZERO_WIDTH_RE,
  AUDIT_JSON_SCHEMA_HINT,
  sanitizeZeroWidth,
  extractAuditJSON,
  formatAuditProseFromJson,
  formatAuditForRewrite,
  filterAcceptedSuggestions,
  normalizeAuditJson,
};