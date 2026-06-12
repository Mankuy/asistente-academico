const { sanitizeZeroWidth, extractJsonSubstring } = require('./audit_json');
const { ZERO_WIDTH_RE } = require('./audit_json');
const { stripHomoglyphs } = require('./integrity_verify');

const VALID_REVISION_TIPOS = new Set(['metodologico', 'formal', 'citacion', 'argumental']);
const VALID_REVISION_VALIDEZ = new Set(['valido', 'parcial', 'cuestionable']);
const AI_ARTIFACT_REGEXES = [
  /como modelo de lenguaje/i,
  /\bas an ai\b/i,
  /espero que esto (te )?ayude/i,
  /en resumen, es importante destacar/i,
];

const REVISION_AUDIT_SCHEMA_HINT = `{
  "resumen_dictamen": "síntesis del dictamen del revisor",
  "puntos_revisor": [
    {
      "id": "p1",
      "quote": "fragmento literal del dictamen",
      "tipo": "metodologico|formal|citacion|argumental",
      "validez": "valido|parcial|cuestionable",
      "sugerencia_respuesta": "borrador de respuesta académica"
    }
  ],
  "indicios_ia": {
    "nivel": "bajo|medio|alto",
    "señales": [
      { "detalle": "descripción", "verificado_por_codigo": false }
    ]
  },
  "recomendacion_general": "orientación para la carta de respuesta"
}`;

function normalizeRevisionTipo(value) {
  const raw = String(value || 'argumental').trim().toLowerCase();
  return VALID_REVISION_TIPOS.has(raw) ? raw : 'argumental';
}

function normalizeRevisionValidez(value) {
  const raw = String(value || 'parcial').trim().toLowerCase();
  return VALID_REVISION_VALIDEZ.has(raw) ? raw : 'parcial';
}

function validezToSeverity(validez) {
  if (validez === 'cuestionable') return 'CRÍTICO';
  if (validez === 'parcial') return 'IMPORTANTE';
  return 'MENOR';
}

function normalizeRevisionPoint(item, index) {
  if (!item || typeof item !== 'object') return null;
  const quote = sanitizeZeroWidth(item.quote || '').trim();
  const sugerencia = sanitizeZeroWidth(item.sugerencia_respuesta || item.sugerencia || '').trim();
  if (!quote && !sugerencia) return null;

  const tipo = normalizeRevisionTipo(item.tipo);
  const validez = normalizeRevisionValidez(item.validez);

  return {
    id: String(item.id || `p${index + 1}`),
    quote: quote || '(punto no citado)',
    tipo,
    validez,
    sugerencia_respuesta: sugerencia || 'Responder con argumentos académicos.',
    severity: validezToSeverity(validez),
    norm_ref: `Revisión por pares · ${tipo}`,
    replacement: sugerencia || 'Incluir en la carta de respuesta.',
    explanation: `Validez del punto: ${validez}. ${sugerencia || ''}`.trim(),
    quote_verified: true,
  };
}

function normalizeIndiciosIa(parsed, codeSignals = []) {
  const fromLlm = parsed?.indicios_ia && typeof parsed.indicios_ia === 'object' ? parsed.indicios_ia : {};
  const llmSignals = Array.isArray(fromLlm.señales)
    ? fromLlm.señales
    : Array.isArray(fromLlm.senales)
      ? fromLlm.senales
      : [];

  const mergedSignals = [
    ...codeSignals,
    ...llmSignals.map((item) => ({
      detalle: sanitizeZeroWidth(item?.detalle || item?.descripcion || '').trim(),
      verificado_por_codigo: Boolean(item?.verificado_por_codigo),
    })).filter((item) => item.detalle),
  ];

  const nivelRaw = String(fromLlm.nivel || '').trim().toLowerCase();
  let nivel = ['bajo', 'medio', 'alto'].includes(nivelRaw) ? nivelRaw : 'bajo';
  const codeStrong = codeSignals.length > 0;
  const llmStrong = llmSignals.length >= 3;
  if (codeStrong && llmStrong) nivel = 'alto';
  else if (codeStrong || llmStrong || mergedSignals.length >= 2) nivel = 'medio';

  return { nivel, señales: mergedSignals };
}

function mapRevisionToSuggestionCards(puntos) {
  return (puntos || []).map((punto) => ({
    id: punto.id,
    quote: punto.quote,
    replacement: punto.sugerencia_respuesta,
    explanation: `Tipo: ${punto.tipo} · Validez: ${punto.validez}. ${punto.sugerencia_respuesta}`,
    norm_ref: `Dictamen · ${punto.tipo}`,
    severity: punto.severity || validezToSeverity(punto.validez),
    quote_verified: true,
  }));
}

function normalizeRevisionAuditJson(parsed, codeSignals = []) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const puntos = Array.isArray(parsed.puntos_revisor)
    ? parsed.puntos_revisor.map(normalizeRevisionPoint).filter(Boolean)
    : [];

  const indicios_ia = normalizeIndiciosIa(parsed, codeSignals);
  const resumen = sanitizeZeroWidth(parsed.resumen_dictamen || parsed.resumen || '').trim()
    || 'Sin resumen del dictamen.';
  const recomendacion = sanitizeZeroWidth(parsed.recomendacion_general || '').trim()
    || 'Redactar una carta de respuesta formal punto por punto.';

  return {
    docType: 'revision',
    resumen_dictamen: resumen,
    recomendacion_general: recomendacion,
    puntos_revisor: puntos,
    indicios_ia,
    resumen,
    veredicto: 'apto_con_reservas',
    sugerencias: mapRevisionToSuggestionCards(puntos),
    checklist: [],
    biblio_check: [],
  };
}

function formatRevisionAuditProse(auditJson) {
  const lines = [
    `**Resumen del dictamen:** ${auditJson.resumen_dictamen}`,
    `**Recomendación general:** ${auditJson.recomendacion_general}`,
    '',
  ];

  if (auditJson.puntos_revisor.length) {
    lines.push('**Puntos del revisor:**');
    auditJson.puntos_revisor.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.tipo}/${item.validez}] ${item.quote}`);
      lines.push(`   → Respuesta sugerida: ${item.sugerencia_respuesta}`);
    });
    lines.push('');
  }

  if (auditJson.indicios_ia?.señales?.length) {
    lines.push('**Indicios contextuales (no concluyentes):**');
    auditJson.indicios_ia.señales.forEach((item, index) => {
      const tag = item.verificado_por_codigo ? '[verificado por código]' : '[lectura LLM]';
      lines.push(`${index + 1}. ${tag} ${item.detalle}`);
    });
  }

  return lines.join('\n').trim();
}

function extractRevisionAuditJSON(rawText, codeSignals = []) {
  const auditRaw = sanitizeZeroWidth(String(rawText || ''));
  const jsonSlice = extractJsonSubstring(auditRaw);

  if (jsonSlice) {
    try {
      const parsed = JSON.parse(jsonSlice);
      const auditJson = normalizeRevisionAuditJson(parsed, codeSignals);
      if (auditJson) {
        return {
          auditMode: 'json',
          auditRaw,
          auditJson,
          audit: formatRevisionAuditProse(auditJson),
        };
      }
    } catch {
      /* fallback */
    }
  }

  return {
    auditMode: 'prose',
    auditRaw,
    auditJson: null,
    audit: auditRaw.trim() || 'La auditoría del dictamen no devolvió contenido utilizable.',
  };
}

function filterAcceptedRevisionPoints(auditJson, acceptedIds) {
  if (!auditJson || !Array.isArray(auditJson.puntos_revisor)) return auditJson;
  const accepted = new Set(acceptedIds || []);
  const puntos = auditJson.puntos_revisor.filter((item) => accepted.has(item.id));
  return {
    ...auditJson,
    puntos_revisor: puntos,
    sugerencias: mapRevisionToSuggestionCards(puntos),
  };
}

function formatRevisionForRewrite(auditJson) {
  if (!auditJson) return '';
  return formatRevisionAuditProse(auditJson);
}

function detectInvisibleCharacterSignals(text) {
  const raw = String(text || '');
  if (!ZERO_WIDTH_RE.test(raw)) return [];
  ZERO_WIDTH_RE.lastIndex = 0;
  return [{
    detalle: 'El dictamen contiene caracteres invisibles o de ancho cero (posible manipulación de texto).',
    verificado_por_codigo: true,
  }];
}

function detectHomoglyphSignals(text) {
  const raw = String(text || '');
  const normalized = stripHomoglyphs(raw);
  if (normalized === raw) return [];
  return [{
    detalle: 'El dictamen contiene homoglifos unicode (caracteres que imitan letras latinas).',
    verificado_por_codigo: true,
  }];
}

function detectArtifactPhraseSignals(text) {
  const raw = String(text || '');
  const signals = [];
  for (const regex of AI_ARTIFACT_REGEXES) {
    if (regex.test(raw)) {
      signals.push({
        detalle: `Frase-artefacto detectada: ${raw.match(regex)?.[0] || 'patrón típico de IA'}`,
        verificado_por_codigo: true,
      });
    }
  }
  return signals;
}

function detectDeterministicRevisionSignals(text) {
  return [
    ...detectInvisibleCharacterSignals(text),
    ...detectHomoglyphSignals(text),
    ...detectArtifactPhraseSignals(text),
  ];
}

module.exports = {
  REVISION_AUDIT_SCHEMA_HINT,
  extractRevisionAuditJSON,
  normalizeRevisionAuditJson,
  formatRevisionAuditProse,
  formatRevisionForRewrite,
  filterAcceptedRevisionPoints,
  detectDeterministicRevisionSignals,
  mapRevisionToSuggestionCards,
};