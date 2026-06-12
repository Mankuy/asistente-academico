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
const { isPreservedFragment, sessionHasPreservedCover } = require('./sessions_store');

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

function splitBodyPreserved(text) {
  const marker = /###\s*Referencias Bibliográficas/i;
  const raw = String(text || '');
  const match = raw.match(marker);
  if (!match) {
    return { body: raw, references: '' };
  }
  return {
    body: raw.slice(0, match.index),
    references: raw.slice(match.index).replace(marker, '').trim(),
  };
}

function getSortedFragments(chapters) {
  return [...(chapters || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
}

function getFragmentHeadingLevel(fragment) {
  if (!fragment) return 0;
  if (fragment.headingLevel !== undefined && fragment.headingLevel !== null) {
    const level = Number(fragment.headingLevel);
    return level === 1 || level === 2 ? level : 0;
  }
  return fragment.isChapterStart ? 1 : 0;
}

function assembleSessionBlocks(chapters) {
  const sorted = getSortedFragments(chapters);
  let markedChapterNum = 0;
  const segments = [];

  for (const fragment of sorted) {
    const preserved = isPreservedFragment(fragment);
    const bodySource = fragment.optimizedText || fragment.originalText || '';
    const body = preserved
      ? splitBodyPreserved(bodySource).body
      : splitBodyAndReferences(bodySource).body;

    if (preserved) {
      if (body) {
        segments.push({
          type: 'body_verbatim',
          text: body,
          verbatimStyle: fragment.kind === 'caratula' ? 'centered' : 'left',
        });
      }
      continue;
    }

    const headingLevel = getFragmentHeadingLevel(fragment);
    if (headingLevel === 1) {
      markedChapterNum += 1;
      const title = String(fragment.chapterTitle || '').trim() || `Capítulo ${markedChapterNum}`;
      segments.push({ type: 'heading', level: 1, title });
    } else if (headingLevel === 2) {
      const title = String(fragment.chapterTitle || '').trim();
      if (title) {
        segments.push({ type: 'heading', level: 2, title });
      }
    }

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

function subheadingParagraph(title, norma) {
  const isApa = String(norma || '').startsWith('APA');
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: isApa ? 240 : 200, after: 160 },
    children: [new TextRun({ text: title, bold: true, size: isApa ? 24 : 22 })],
  });
}

function verbatimParagraphs(text, norma, options = {}) {
  const centered = options.centered === true;
  const lines = String(text || '').split('\n');
  return lines.map((line) => paragraphFromLine(line, {
    alignment: centered ? AlignmentType.CENTER : undefined,
    spacing: { line: 480, after: line.trim() ? 120 : 60 },
    indent: undefined,
  }));
}

function buildBodyFromSegments(segments, norma) {
  const children = [];
  for (const segment of segments) {
    if (segment.type === 'heading') {
      if (segment.level === 2) {
        children.push(subheadingParagraph(segment.title, norma));
      } else {
        children.push(headingParagraph(segment.title, norma));
      }
      continue;
    }
    if (segment.type === 'body_verbatim') {
      children.push(...verbatimParagraphs(segment.text, norma, {
        centered: segment.verbatimStyle === 'centered',
      }));
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

function buildGenericDocument({ title, author, body, references, skipAutoCover = false }) {
  const children = [];
  if (!skipAutoCover) {
    children.push(
      paragraphFromLine(title, { size: 32 }),
      paragraphFromLine(author, { size: 26 }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }
  children.push(...bodyParagraphs(body, 'GENERIC'));
  if (references) {
    children.push(paragraphFromLine('Referencias', { size: 26 }));
    children.push(...referenceParagraphs(references, 'GENERIC'));
  }
  return new Document({ sections: [{ children }] });
}

function buildApaDocumentFromSegments({ title, author, segments, references, skipAutoCover = false }) {
  const children = [];
  if (!skipAutoCover) {
    children.push(
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
      new Paragraph({ children: [new PageBreak()] })
    );
  }
  children.push(...buildBodyFromSegments(segments, 'APA'));

  if (references) {
    children.push(new Paragraph({
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: 'Referencias', bold: true, size: 26 })],
    }));
    children.push(...referenceParagraphs(references, 'APA'));
  }

  return new Document({ sections: [{ children }] });
}

function buildMlaDocumentFromSegments({ title, author, authorLastName, segments, references, skipAutoCover = false }) {
  const lastName = authorLastName || author.split(/\s+/).pop() || 'Autor';
  const children = [];
  if (!skipAutoCover) {
    children.push(
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
      new Paragraph({ children: [new PageBreak()] })
    );
  }
  children.push(...buildBodyFromSegments(segments, 'MLA'));

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
    const skipAutoCover = sessionHasPreservedCover(session.chapters);
    if (norma.startsWith('MLA')) {
      document = buildMlaDocumentFromSegments({
        title: docTitle,
        author,
        authorLastName,
        segments,
        references,
        skipAutoCover,
      });
    } else if (norma.startsWith('APA')) {
      document = buildApaDocumentFromSegments({
        title: docTitle,
        author,
        segments,
        references,
        skipAutoCover,
      });
    } else {
      const body = segments.map((s) => (s.type === 'heading' ? s.title : s.text)).join('\n\n');
      document = buildGenericDocument({
        title: docTitle,
        author,
        body,
        references,
        skipAutoCover,
      });
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
  getFragmentHeadingLevel,
  getSortedFragments,
  splitBodyAndReferences,
};