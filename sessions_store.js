const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');
const SESSION_NAME_MAX = 48;
const CHAPTER_TITLE_MAX = 40;
const EXCERPT_ORIGINAL_MAX = 400;
const EXCERPT_OPTIMIZED_MAX = 2200;
const EXCERPT_AUDIT_MAX = 1200;
const MAX_CONTEXT_CHAPTERS = 4;
const MAX_USAGE_ENTRIES = 80;

function emptyUsage() {
  return {
    totalCostUsd: 0,
    totalRequests: 0,
    totalChars: 0,
    entries: [],
  };
}

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function generateId() {
  return crypto.randomUUID();
}

function sanitizeLine(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveTitleFromText(text, maxLen = SESSION_NAME_MAX) {
  const clean = sanitizeLine(text);
  if (!clean) return 'Sesión sin título';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trim()}…`;
}

function sessionFilePath(id) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function readSessionFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeSessionFile(session) {
  ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf8');
}

function listSessions() {
  ensureSessionsDir();
  const files = fs.readdirSync(SESSIONS_DIR).filter((name) => name.endsWith('.json'));
  const sessions = files.map((fileName) => {
    try {
      const session = readSessionFile(path.join(SESSIONS_DIR, fileName));
      return {
        id: session.id,
        name: session.name,
        norma: session.norma,
        nivel: session.nivel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        chapterCount: Array.isArray(session.chapters) ? session.chapters.length : 0,
        usage: session.usage || emptyUsage(),
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

function getSession(id) {
  const filePath = sessionFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  return readSessionFile(filePath);
}

function createSession({ name, norma, nivel, seedText }) {
  const now = new Date().toISOString();
  const autoName = deriveTitleFromText(seedText || '');
  const session = {
    id: generateId(),
    name: sanitizeLine(name) || autoName || 'Nueva sesión',
    nameAuto: !sanitizeLine(name),
    norma: norma || 'APA 7ª ed.',
    nivel: nivel || 'Trabajo de Grado',
    createdAt: now,
    updatedAt: now,
    chapters: [],
    usage: emptyUsage(),
  };
  writeSessionFile(session);
  return session;
}

function recordSessionUsage(sessionId, entry = {}) {
  const session = getSession(sessionId);
  if (!session) return null;

  const usage = session.usage && typeof session.usage === 'object'
    ? session.usage
    : emptyUsage();

  const costUsd = Math.max(0, Number(entry.costUsd) || 0);
  const charCount = Math.max(0, Number(entry.charCount) || 0);
  const stage = String(entry.stage || 'full');
  const model = String(entry.model || '').trim();

  usage.totalCostUsd = Math.round((usage.totalCostUsd + costUsd) * 10000) / 10000;
  usage.totalRequests += 1;
  usage.totalChars += charCount;
  usage.entries.push({
    stage,
    costUsd,
    charCount,
    model,
    at: new Date().toISOString(),
  });

  if (usage.entries.length > MAX_USAGE_ENTRIES) {
    usage.entries = usage.entries.slice(-MAX_USAGE_ENTRIES);
  }

  session.usage = usage;
  writeSessionFile(session);
  return usage;
}

function updateSession(id, updates = {}) {
  const session = getSession(id);
  if (!session) return null;

  if (typeof updates.name === 'string') {
    const trimmed = sanitizeLine(updates.name);
    if (trimmed) {
      session.name = trimmed;
      session.nameAuto = false;
    }
  }

  if (updates.norma) session.norma = updates.norma;
  if (updates.nivel) session.nivel = updates.nivel;

  writeSessionFile(session);
  return session;
}

function deleteSession(id) {
  const filePath = sessionFilePath(id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function addChapter(sessionId, payload = {}) {
  const session = getSession(sessionId);
  if (!session) return null;

  const chapterIndex = session.chapters.length + 1;
  const originalText = String(payload.originalText || '').trim();
  const audit = String(payload.audit || '').trim();
  const optimizedText = String(payload.optimizedText || '').trim();

  if (!originalText || !audit || !optimizedText) {
    throw new Error('Capítulo incompleto: se requiere originalText, audit y optimizedText.');
  }

  const isChapterStart = Boolean(payload.isChapterStart);
  const chapterTitle = isChapterStart ? sanitizeLine(payload.chapterTitle) : '';

  const chapter = {
    id: generateId(),
    index: chapterIndex,
    title: sanitizeLine(payload.title) || deriveTitleFromText(originalText, CHAPTER_TITLE_MAX) || `Fragmento ${chapterIndex}`,
    isChapterStart,
    chapterTitle,
    originalText,
    audit,
    auditJson: payload.auditJson && typeof payload.auditJson === 'object' ? payload.auditJson : null,
    optimizedText,
    norma: payload.norma || session.norma,
    nivel: payload.nivel || session.nivel,
    createdAt: new Date().toISOString(),
  };

  session.chapters.push(chapter);

  if (session.nameAuto && chapterIndex === 1) {
    session.name = deriveTitleFromText(originalText);
  }

  if (payload.norma) session.norma = payload.norma;
  if (payload.nivel) session.nivel = payload.nivel;

  writeSessionFile(session);
  return { session, chapter };
}

function deleteChapter(sessionId, chapterId) {
  const session = getSession(sessionId);
  if (!session) return null;

  const before = session.chapters.length;
  session.chapters = session.chapters.filter((ch) => ch.id !== chapterId);
  if (session.chapters.length === before) return null;

  session.chapters.forEach((ch, idx) => {
    ch.index = idx + 1;
  });

  writeSessionFile(session);
  return session;
}

/**
 * Renombra el fragmento (solo `title`).
 * CONTRATO: no modificar originalText, optimizedText, audit, chapterTitle ni index.
 */
function renameChapter(sessionId, chapterId, title) {
  const session = getSession(sessionId);
  if (!session) return null;

  const chapter = session.chapters.find((ch) => ch.id === chapterId);
  if (!chapter) return null;

  chapter.title = sanitizeLine(title);
  writeSessionFile(session);
  return session;
}

function validateChapterOrderIds(chapters, orderedIds) {
  const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
  if (!ids.length && chapters.length) {
    throw new Error('El orden de fragmentos no puede estar vacío.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('El orden de fragmentos contiene IDs duplicados.');
  }

  const expected = new Set(chapters.map((ch) => ch.id));
  const received = new Set(ids);
  if (expected.size !== received.size) {
    throw new Error('El orden debe incluir exactamente todos los fragmentos de la sesión.');
  }
  for (const id of expected) {
    if (!received.has(id)) {
      throw new Error('El orden debe incluir exactamente todos los fragmentos de la sesión.');
    }
  }
}

/**
 * Reordena fragmentos según orderedIds y reasigna index secuencial (1, 2, 3…).
 * Afecta el texto ensamblado, el export y el contexto de coherencia de estilo del LLM.
 * No renombra chapterTitle ni renumera encabezados "Capítulo X" automáticamente.
 */
function reorderChapters(sessionId, orderedIds) {
  const session = getSession(sessionId);
  if (!session) return null;

  validateChapterOrderIds(session.chapters, orderedIds);

  const byId = new Map(session.chapters.map((ch) => [ch.id, ch]));
  session.chapters = orderedIds.map((id, idx) => {
    const chapter = byId.get(id);
    chapter.index = idx + 1;
    return chapter;
  });

  writeSessionFile(session);
  return session;
}

function truncateExcerpt(text, maxLen) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function buildSessionContextForLlm(session) {
  if (!session || !Array.isArray(session.chapters) || !session.chapters.length) {
    return null;
  }

  const sortedChapters = [...session.chapters].sort((a, b) => (a.index || 0) - (b.index || 0));
  const previousChapters = sortedChapters
    .slice(-MAX_CONTEXT_CHAPTERS)
    .map((ch) => ({
      title: ch.title,
      originalExcerpt: truncateExcerpt(ch.originalText, EXCERPT_ORIGINAL_MAX),
      optimizedExcerpt: truncateExcerpt(ch.optimizedText, EXCERPT_OPTIMIZED_MAX),
      auditSummary: truncateExcerpt(ch.audit, EXCERPT_AUDIT_MAX),
    }));

  return {
    sessionId: session.id,
    sessionName: session.name,
    norma: session.norma,
    nivel: session.nivel,
    chapterCount: session.chapters.length,
    previousChapters,
  };
}

module.exports = {
  SESSIONS_DIR,
  emptyUsage,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  addChapter,
  deleteChapter,
  renameChapter,
  reorderChapters,
  validateChapterOrderIds,
  recordSessionUsage,
  buildSessionContextForLlm,
  deriveTitleFromText,
};