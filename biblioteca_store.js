const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BIBLIOTECA_DIR = path.join(__dirname, 'biblioteca');
const INDEX_PATH = path.join(__dirname, 'data', 'biblioteca_index.json');
const CHUNK_WORDS = 220;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

let cachedIndex = null;

function ensureBibliotecaDir() {
  fs.mkdirSync(BIBLIOTECA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function chunkText(text, source, chunkWords = CHUNK_WORDS) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkWords) {
    const slice = words.slice(i, i + chunkWords).join(' ');
    if (!slice.trim()) continue;
    chunks.push({
      id: crypto.randomUUID(),
      source,
      text: slice.trim(),
      tokens: tokenize(slice),
    });
  }
  return chunks;
}

async function extractPdfText(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
  } catch {
    return '';
  }
}

async function extractDocxText(filePath) {
  try {
    const mammoth = require('mammoth');
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').trim();
  } catch {
    return '';
  }
}

async function extractBibliotecaFileText(filePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return extractPdfText(filePath);
  if (ext === '.docx') return extractDocxText(filePath);
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8').trim();
  return '';
}

function buildBm25Stats(chunks) {
  const docs = chunks.map((chunk) => chunk.tokens);
  const docCount = docs.length || 1;
  const docLengths = docs.map((tokens) => tokens.length || 1);
  const avgDl = docLengths.reduce((sum, len) => sum + len, 0) / docCount;
  const df = new Map();

  docs.forEach((tokens) => {
    const unique = new Set(tokens);
    unique.forEach((term) => df.set(term, (df.get(term) || 0) + 1));
  });

  return { docs, docLengths, avgDl, df, docCount };
}

function scoreBm25(queryTokens, stats, docIndex) {
  const tokens = stats.docs[docIndex];
  const dl = stats.docLengths[docIndex];
  const tf = new Map();
  tokens.forEach((term) => tf.set(term, (tf.get(term) || 0) + 1));

  let score = 0;
  queryTokens.forEach((term) => {
    const freq = tf.get(term) || 0;
    if (!freq) return;
    const docFreq = stats.df.get(term) || 0;
    const idf = Math.log(1 + (stats.docCount - docFreq + 0.5) / (docFreq + 0.5));
    const numerator = freq * (BM25_K1 + 1);
    const denominator = freq + BM25_K1 * (1 - BM25_B + BM25_B * (dl / stats.avgDl));
    score += idf * (numerator / denominator);
  });

  return score;
}

function loadIndex() {
  if (cachedIndex) return cachedIndex;
  ensureBibliotecaDir();
  if (!fs.existsSync(INDEX_PATH)) {
    cachedIndex = { updatedAt: null, chunks: [], stats: null };
    return cachedIndex;
  }
  try {
    cachedIndex = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    cachedIndex.stats = buildBm25Stats(cachedIndex.chunks || []);
    return cachedIndex;
  } catch {
    cachedIndex = { updatedAt: null, chunks: [], stats: null };
    return cachedIndex;
  }
}

function saveIndex(index) {
  ensureBibliotecaDir();
  const payload = {
    updatedAt: new Date().toISOString(),
    chunks: index.chunks,
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(payload, null, 2), 'utf8');
  cachedIndex = {
    ...payload,
    stats: buildBm25Stats(payload.chunks),
  };
  return cachedIndex;
}

async function rebuildBibliotecaIndex() {
  ensureBibliotecaDir();
  const files = fs.readdirSync(BIBLIOTECA_DIR).filter((name) => !name.startsWith('.'));
  const chunks = [];

  for (const fileName of files) {
    const filePath = path.join(BIBLIOTECA_DIR, fileName);
    if (!fs.statSync(filePath).isFile()) continue;
    const text = await extractBibliotecaFileText(filePath, fileName);
    if (!text) continue;
    chunks.push(...chunkText(text, fileName));
  }

  return saveIndex({ chunks });
}

function searchBibliotecaLocal(query, topK = 3) {
  const index = loadIndex();
  const chunks = index.chunks || [];
  if (!chunks.length) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const stats = index.stats || buildBm25Stats(chunks);
  const ranked = chunks
    .map((chunk, docIndex) => ({
      chunk,
      score: scoreBm25(queryTokens, stats, docIndex),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => ({
      source: item.chunk.source,
      text: item.chunk.text,
      score: item.score,
    }));

  return ranked;
}

function formatLocalBibliotecaHits(query, hits) {
  if (!hits.length) return '';
  return hits
    .map((hit, index) => `${index + 1}. [FUENTE LOCAL: ${hit.source}] (score ${hit.score.toFixed(2)})\n${hit.text}`)
    .join('\n\n');
}

function getBibliotecaStatus() {
  const index = loadIndex();
  const files = fs.existsSync(BIBLIOTECA_DIR)
    ? fs.readdirSync(BIBLIOTECA_DIR).filter((name) => !name.startsWith('.'))
    : [];
  return {
    files,
    chunkCount: (index.chunks || []).length,
    updatedAt: index.updatedAt || null,
    directory: BIBLIOTECA_DIR,
  };
}

module.exports = {
  BIBLIOTECA_DIR,
  INDEX_PATH,
  ensureBibliotecaDir,
  rebuildBibliotecaIndex,
  searchBibliotecaLocal,
  formatLocalBibliotecaHits,
  getBibliotecaStatus,
  tokenize,
};