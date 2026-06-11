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

function getSortedFragments(chapters) {
  return [...(chapters || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
}

function assembleSessionBlocks(chapters) {
  const sorted = getSortedFragments(chapters);
  let markedChapterNum = 0;
  const segments = [];

  for (const fragment of sorted) {
    if (Boolean(fragment.isChapterStart)) {
      markedChapterNum += 1;
      const title = String(fragment.chapterTitle || '').trim() || `Capítulo ${markedChapterNum}`;
      segments.push({ type: 'heading', title });
    }

    const body = splitBodyAndReferences(fragment.optimizedText || '').body;
    if (body) {
      segments.push({ type: 'body', text: body });
    }
  }

  const references = sorted
    .map((fragment) => splitBodyAndReferences(fragment.optimizedText || '').references)
    .filter(Boolean)
    .pop() || '';

  return { segments, references };
}

function buildSessionExportText(session) {
  const { segments, references } = assembleSessionBlocks(session?.chapters || []);
  const parts = segments.map((segment) => (
    segment.type === 'heading' ? segment.title : segment.text
  ));

  let combined = parts.filter(Boolean).join('\n\n');
  if (references) {
    combined += `\n\n### Referencias Bibliográficas\n\n${references}`;
  }
  return combined;
}

function headingParagraph(title, norma) {
  const isApa = String(norma || '').startsWith('APA');
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: isApa ? 320 : 240, after: 240 },
    children: [new TextRun({ text: title, bold: true, size: isApa ? 28 : 26 })],
  });
}

function buildBodyFromSegments(segments, norma) {
  const children = [];
  for (const segment of segments) {
    if (segment.type === 'heading') {
      children.push(headingParagraph(segment.title, norma));
      continue;
    }
    children.push(...bodyParagraphs(segment.text, norma));
  }
  return children;
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

function buildApaDocumentFromSegments({ title, author, segments, references }) {
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
    ...buildBodyFromSegments(segments, 'APA'),
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

function buildMlaDocumentFromSegments({ title, author, authorLastName, segments, references }) {
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
    ...buildBodyFromSegments(segments, 'MLA'),
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

async function exportDocxEntregable({
  text,
  session = null,
  norma = 'APA 7ª ed.',
  title = 'Trabajo académico',
  author = 'Autor',
  authorLastName = '',
  sessionName = '',
}) {
  ensureEntregablesDir();
  const docTitle = title || sessionName || 'Trabajo académico';

  let document;
  if (session?.chapters?.length) {
    const { segments, references } = assembleSessionBlocks(session.chapters);
    if (norma.startsWith('MLA')) {
      document = buildMlaDocumentFromSegments({ title: docTitle, author, authorLastName, segments, references });
    } else if (norma.startsWith('APA')) {
      document = buildApaDocumentFromSegments({ title: docTitle, author, segments, references });
    } else {
      const body = segments.map((s) => (s.type === 'heading' ? s.title : s.text)).join('\n\n');
      document = buildGenericDocument({ title: docTitle, author, body, references });
    }
  } else {
    const { body, references } = splitBodyAndReferences(text);
    if (norma.startsWith('MLA')) {
      document = buildMlaDocument({ title: docTitle, author, authorLastName, body, references });
    } else if (norma.startsWith('APA')) {
      document = buildApaDocument({ title: docTitle, author, body, references });
    } else {
      document = buildGenericDocument({ title: docTitle, author, body, references });
    }
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

module.exports = {
  ENTREGABLES_DIR,
  ensureEntregablesDir,
  safeEntregablePath,
  exportDocxEntregable,
  buildSessionExportText,
  assembleSessionBlocks,
  getSortedFragments,
  splitBodyAndReferences,
};