const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  ensureEntregablesDir,
  safeEntregablePath,
  assembleSessionBlocks,
  splitBodyAndReferences,
} = require('./docx_export');

const PAGE_MARGIN = 72;
const FONT_SIZE = 12;
const LINE_HEIGHT = 24;

function slugifyFilename(name) {
  return String(name || 'entregable')
    .replace(/[^\w\s-áéíóúñ]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'entregable';
}

function writeParagraph(doc, text, options = {}) {
  const content = String(text || '').trim();
  if (!content) return;

  doc.font('Times-Roman').fontSize(FONT_SIZE);
  doc.text(content, {
    align: options.align || 'left',
    indent: options.indent || 0,
    paragraphGap: options.paragraphGap ?? 10,
    lineGap: options.lineGap ?? (LINE_HEIGHT - FONT_SIZE),
    underline: options.underline || false,
  });
}

function writeHeading(doc, title, norma) {
  doc.moveDown(0.5);
  doc.font('Times-Bold').fontSize(FONT_SIZE + 1);
  doc.text(title, {
    align: 'center',
    lineGap: 4,
  });
  doc.font('Times-Roman').fontSize(FONT_SIZE);
  doc.moveDown(0.4);
}

function writeCover(doc, { title, author, norma }) {
  doc.moveDown(6);
  if (norma.startsWith('MLA')) {
    writeParagraph(doc, author, { align: 'center' });
    doc.moveDown(1);
    writeParagraph(doc, title, { align: 'center', underline: false });
  } else {
    writeParagraph(doc, title, { align: 'center' });
    doc.moveDown(1);
    writeParagraph(doc, author, { align: 'center' });
  }
  doc.addPage();
}

function writeBodyParagraph(doc, text, norma) {
  const firstLineIndent = norma.startsWith('APA') ? 36 : 0;
  writeParagraph(doc, text, {
    indent: firstLineIndent,
    lineGap: LINE_HEIGHT - FONT_SIZE,
    paragraphGap: 0,
  });
}

function writeReferenceLine(doc, line, norma) {
  const hanging = norma.startsWith('APA') ? 36 : 18;
  writeParagraph(doc, line, {
    indent: -hanging,
    paragraphGap: 6,
    lineGap: LINE_HEIGHT - FONT_SIZE,
  });
  doc.x = PAGE_MARGIN + hanging;
}

function attachPageNumbers(doc) {
  let pageIndex = 0;
  doc.on('pageAdded', () => {
    pageIndex += 1;
    if (pageIndex === 1) return;
    doc.save();
    doc.font('Times-Roman').fontSize(10);
    doc.text(
      String(pageIndex - 1),
      0,
      doc.page.height - 48,
      { align: 'center', width: doc.page.width, lineBreak: false }
    );
    doc.restore();
  });
}

async function exportPdfEntregable({
  session,
  norma = 'APA 7ª ed.',
  title = 'Trabajo académico',
  author = 'Autor',
  sessionName = '',
}) {
  ensureEntregablesDir();
  const docTitle = title || sessionName || 'Trabajo académico';
  const { segments, references } = assembleSessionBlocks(session?.chapters || []);

  const filename = `${slugifyFilename(sessionName || docTitle)}_${Date.now().toString(36)}.pdf`;
  const filePath = safeEntregablePath(filename);

  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'LETTER' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  attachPageNumbers(doc);

  writeCover(doc, { title: docTitle, author, norma });

  for (const segment of segments) {
    if (segment.type === 'heading') {
      writeHeading(doc, segment.title, norma);
      continue;
    }

    const paragraphs = String(segment.text || '').split(/\n+/).filter((line) => line.trim());
    for (const paragraph of paragraphs) {
      writeBodyParagraph(doc, paragraph.trim(), norma);
    }
  }

  if (references) {
    doc.moveDown(1);
    const refTitle = norma.startsWith('MLA') ? 'Works Cited' : 'Referencias';
    doc.font('Times-Bold').fontSize(FONT_SIZE + 1);
    doc.text(refTitle);
    doc.font('Times-Roman').fontSize(FONT_SIZE);
    doc.moveDown(0.3);

    const refLines = references.split(/\n+/).filter((line) => line.trim());
    for (const line of refLines) {
      writeReferenceLine(doc, line.trim(), norma);
    }
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const bytes = fs.statSync(filePath).size;
  return {
    filename,
    filePath,
    downloadUrl: `/api/entregables/${encodeURIComponent(filename)}`,
    bytes,
  };
}

module.exports = {
  exportPdfEntregable,
};