const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Header,
  AlignmentType,
  PageBreak,
} = require('docx');

const ENTREGABLES_DIR = path.join(__dirname, 'entregables');

function ensureEntregablesDir() {
  fs.mkdirSync(ENTREGABLES_DIR, { recursive: true });
}

function safeEntregablePath(filename) {
  const base = path.basename(String(filename || ''));
  if (!base || base !== filename || base.includes('..')) {
    throw new Error('Nombre de archivo no válido');
  }
  const target = path.join(ENTREGABLES_DIR, base);
  const resolved = path.resolve(target);
  const root = path.resolve(ENTREGABLES_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Ruta de entregable no permitida');
  }
  return resolved;
}

function splitBodyAndReferences(text) {
  const marker = /###\s*Referencias Bibliográficas/i;
  const match = String(text || '').match(marker);
  if (!match) {
    return { body: String(text || '').trim(), references: '' };
  }
  const idx = match.index;
  return {
    body: String(text).slice(0, idx).trim(),
    references: String(text).slice(idx).replace(marker, '').trim(),
  };
}

function paragraphFromLine(line, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    spacing: options.spacing || { line: 480, after: 160 },
    indent: options.indent,
    children: [new TextRun({ text: line, size: options.size || 24 })],
  });
}

function bodyParagraphs(text, norma) {
  const lines = String(text || '').split(/\n+/).filter((line) => line.trim());
  return lines.map((line) => paragraphFromLine(line.trim(), {
    spacing: { line: 480, after: 160 },
    indent: norma.startsWith('APA') ? { firstLine: 720 } : undefined,
  }));
}

function referenceParagraphs(references, norma) {
  if (!references) return [];
  const lines = references.split(/\n+/).filter((line) => line.trim());
  const hanging = norma.startsWith('APA')
    ? { left: 720, hanging: 720 }
    : { left: 720, hanging: 360 };

  return lines.map((line) => paragraphFromLine(line.trim(), {
    spacing: { line: 480, after: 120 },
    indent: hanging,
  }));
}

function buildApaDocument({ title, author, body, references }) {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: title, bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
      children: [new TextRun({ text: author, size: 26 })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
    ...bodyParagraphs(body, 'APA'),
  ];

  if (references) {
    children.push(new Paragraph({
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: 'Referencias', bold: true, size: 26 })],
    }));
    children.push(...referenceParagraphs(references, 'APA'));
  }

  return new Document({ sections: [{ children }] });
}

function buildMlaDocument({ title, author, authorLastName, body, references }) {
  const lastName = authorLastName || author.split(/\s+/).pop() || 'Autor';
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({ text: author, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: title, bold: true, size: 28 })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
    ...bodyParagraphs(body, 'MLA'),
  ];

  if (references) {
    children.push(new Paragraph({
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: 'Works Cited', bold: true, size: 26 })],
    }));
    children.push(...referenceParagraphs(references, 'MLA'));
  }

  return new Document({
    sections: [{
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${lastName} `, size: 22 })],
            }),
          ],
        }),
      },
      children,
    }],
  });
}

function buildGenericDocument({ title, author, body, references }) {
  const children = [
    paragraphFromLine(title, { size: 32 }),
    paragraphFromLine(author, { size: 26 }),
    new Paragraph({ children: [new PageBreak()] }),
    ...bodyParagraphs(body, 'GENERIC'),
  ];
  if (references) {
    children.push(paragraphFromLine('Referencias', { size: 26 }));
    children.push(...referenceParagraphs(references, 'GENERIC'));
  }
  return new Document({ sections: [{ children }] });
}

async function exportDocxEntregable({
  text,
  norma = 'APA 7ª ed.',
  title = 'Trabajo académico',
  author = 'Autor',
  authorLastName = '',
  sessionName = '',
}) {
  ensureEntregablesDir();
  const { body, references } = splitBodyAndReferences(text);
  const docTitle = title || sessionName || 'Trabajo académico';

  let document;
  if (norma.startsWith('MLA')) {
    document = buildMlaDocument({ title: docTitle, author, authorLastName, body, references });
  } else if (norma.startsWith('APA')) {
    document = buildApaDocument({ title: docTitle, author, body, references });
  } else {
    document = buildGenericDocument({ title: docTitle, author, body, references });
  }

  const buffer = await Packer.toBuffer(document);
  const slug = (sessionName || docTitle)
    .replace(/[^\w\s-áéíóúñ]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'entregable';
  const filename = `${slug}_${Date.now().toString(36)}.docx`;
  const filePath = safeEntregablePath(filename);
  fs.writeFileSync(filePath, buffer);

  return {
    filename,
    filePath,
    downloadUrl: `/api/entregables/${encodeURIComponent(filename)}`,
    bytes: buffer.length,
  };
}

function buildSessionExportText(session) {
  const chapters = [...(session.chapters || [])].sort((a, b) => a.index - b.index);
  return chapters.map((chapter) => {
    const header = `Capítulo ${chapter.index}: ${chapter.title}`;
    return `${header}\n\n${chapter.optimizedText}`;
  }).join('\n\n---\n\n');
}

module.exports = {
  ENTREGABLES_DIR,
  ensureEntregablesDir,
  safeEntregablePath,
  exportDocxEntregable,
  buildSessionExportText,
  splitBodyAndReferences,
};