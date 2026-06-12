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

    function countWords(text) {
        return String(text || '').split(/\s+/).filter(Boolean).length;
    }

    function getChunkText(chunk) {
        return typeof chunk === 'string' ? chunk : String(chunk?.text || '');
    }

    function isIndexChunk(text) {
        const raw = String(text || '');
        const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return false;
        if (INDEX_START.test(lines[0])) return true;
        const matching = lines.filter((line) => DOT_LEADER_LINE.test(line));
        return matching.length / lines.length >= 0.3;
    }

    function isCoverChunk(text, isFirstChunk) {
        if (!isFirstChunk) return false;
        const raw = String(text || '');
        const words = countWords(raw);
        if (words >= 100) return false;
        const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return false;
        const shortLines = lines.filter((line) => line.length < 60).length;
        if (shortLines / lines.length <= 0.5) return false;
        const markers = raw.match(INSTITUTIONAL_MARKERS) || [];
        return markers.length >= 2;
    }

    function isAckChunk(text) {
        const raw = String(text || '');
        const firstLine = raw.split('\n')[0]?.trim() || '';
        if (!ACK_START.test(firstLine)) return false;
        return countWords(raw) < 250;
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

    return {
        countWords,
        isIndexChunk,
        isCoverChunk,
        isAckChunk,
        classifyPreservedKind,
        annotateThesisChunks,
        defaultLabelForKind,
    };
});