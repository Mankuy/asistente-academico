(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.thesisClassify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function thesisClassifyFactory() {
    const INSTITUTIONAL_MARKERS = /Universidad|Facultad|Instituto|Tesis|Trabajo Final|Licenciatura|Maestría|Doctorado|Tutor|Tutora|Director/gi;
    const DOT_LEADER_LINE = /\.{4,}\s*\d+\s*$/;
    const INDEX_START = /^(Índice|Tabla de contenido|Tabla de contenidos|Contents|Sumario)\b/i;
    const ACK_START = /^(Agradecimientos|Dedicatoria|A mi |A mis )/i;
    const MAX_FRONT_MATTER_PAGES = 10;
    const MAX_COVER_PAGE_INDEX = 2;

    function countWords(text) {
        return String(text || '').split(/\s+/).filter(Boolean).length;
    }

    function getChunkText(chunk) {
        return typeof chunk === 'string' ? chunk : String(chunk?.text || '');
    }

    function getNonEmptyLines(text) {
        return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    }

    function dotLeaderRatio(lines) {
        if (!lines.length) return 0;
        const matching = lines.filter((line) => DOT_LEADER_LINE.test(line));
        return matching.length / lines.length;
    }

    function isIndexPage(text, isContinuation) {
        const lines = getNonEmptyLines(text);
        if (!lines.length) return false;
        if (INDEX_START.test(lines[0])) return true;
        const threshold = isContinuation ? 0.15 : 0.25;
        return dotLeaderRatio(lines) >= threshold;
    }

    function isCoverPage(text, pageIndex) {
        if (pageIndex > MAX_COVER_PAGE_INDEX) return false;
        const raw = String(text || '');
        if (countWords(raw) >= 120) return false;
        const lines = getNonEmptyLines(raw);
        if (!lines.length) return false;
        const shortLines = lines.filter((line) => line.length < 60).length;
        if (shortLines / lines.length <= 0.5) return false;
        const markers = raw.match(INSTITUTIONAL_MARKERS) || [];
        return markers.length >= 2;
    }

    function isAckPage(text) {
        const raw = String(text || '');
        const firstLine = raw.split('\n')[0]?.trim() || '';
        if (!ACK_START.test(firstLine)) return false;
        return countWords(raw) < 250;
    }

    function classifyPageType(pageText, pageIndex, previousPageType) {
        if (isCoverPage(pageText, pageIndex)) {
            return { type: 'caratula', kind: 'caratula', label: 'Carátula' };
        }
        if (isIndexPage(pageText, previousPageType === 'indice')) {
            return { type: 'indice', kind: 'indice', label: 'Índice' };
        }
        if (isAckPage(pageText)) {
            return { type: 'preservado', kind: 'preservado', label: 'Agradecimientos / Dedicatoria' };
        }
        return { type: 'prosa', kind: '', label: 'Prosa auditable' };
    }

    function isIndexChunk(text) {
        return isIndexPage(text, false);
    }

    function isCoverChunk(text, isFirstChunk) {
        return isCoverPage(text, isFirstChunk ? 0 : MAX_COVER_PAGE_INDEX + 1);
    }

    function isAckChunk(text) {
        return isAckPage(text);
    }

    function defaultLabelForKind(kind) {
        if (kind === 'caratula') return 'Carátula';
        if (kind === 'indice') return 'Índice';
        if (kind === 'preservado') return 'Agradecimientos / Dedicatoria';
        return 'Prosa auditable';
    }

    function classifyPreservedKind(chunk, chunkIndex) {
        const text = getChunkText(chunk);
        const isFirstChunk = chunkIndex === 0;
        if (isIndexChunk(text)) {
            return { preserved: true, kind: 'indice', label: 'Índice' };
        }
        if (isCoverChunk(text, isFirstChunk)) {
            return { preserved: true, kind: 'caratula', label: 'Carátula' };
        }
        if (isAckChunk(text)) {
            return { preserved: true, kind: 'preservado', label: 'Agradecimientos / Dedicatoria' };
        }
        return { preserved: false, kind: '', label: 'Prosa auditable' };
    }

    function annotateThesisChunks(chunks) {
        return (chunks || []).map((chunk, index) => {
            const classification = classifyPreservedKind(chunk, index);
            return {
                ...chunk,
                preserved: classification.preserved,
                kind: classification.kind,
                classificationLabel: classification.label,
            };
        });
    }

    function buildPreservedChunkMeta(kind, label, text) {
        return {
            text,
            preserved: true,
            kind,
            classificationLabel: label,
            headingLevel: 0,
            isChapterStart: false,
            chapterTitle: '',
        };
    }

    function mergePreservedPageRuns(pageRuns) {
        const preservedChunks = [];
        let current = null;

        for (const run of pageRuns) {
            if (current && current.kind === run.kind) {
                current.text = `${current.text}\n\n${run.text}`;
                current.pageCount += 1;
                continue;
            }
            if (current) preservedChunks.push(current);
            current = buildPreservedChunkMeta(run.kind, run.label, run.text);
            current.pageCount = 1;
        }
        if (current) preservedChunks.push(current);
        return preservedChunks;
    }

    function buildThesisChunksFromPages(pages, chunkProseFn) {
        const pageList = Array.isArray(pages) ? pages : [];
        if (!pageList.length) return [];

        const scanLimit = Math.min(pageList.length, MAX_FRONT_MATTER_PAGES);
        const pageRuns = [];
        let bodyStartIndex = pageList.length;
        let previousType = null;

        for (let pageIndex = 0; pageIndex < scanLimit; pageIndex += 1) {
            const pageText = String(pageList[pageIndex] || '');
            const classification = classifyPageType(pageText, pageIndex, previousType);
            if (classification.type === 'prosa') {
                bodyStartIndex = pageIndex;
                break;
            }
            pageRuns.push({
                kind: classification.kind,
                label: classification.label,
                text: pageText,
            });
            previousType = classification.type;
            bodyStartIndex = pageIndex + 1;
        }

        const preservedChunks = mergePreservedPageRuns(pageRuns);
        const bodyText = pageList.slice(bodyStartIndex).join('\n\n').trim();
        const auditableChunks = bodyText
            ? (chunkProseFn ? chunkProseFn(bodyText) : []).map((chunk) => ({
                ...chunk,
                preserved: false,
                kind: '',
                classificationLabel: 'Prosa auditable',
            }))
            : [];

        return [...preservedChunks, ...auditableChunks];
    }

    return {
        countWords,
        isIndexChunk,
        isCoverChunk,
        isAckChunk,
        isIndexPage,
        isCoverPage,
        isAckPage,
        classifyPageType,
        classifyPreservedKind,
        annotateThesisChunks,
        buildThesisChunksFromPages,
        defaultLabelForKind,
        MAX_FRONT_MATTER_PAGES,
    };
});