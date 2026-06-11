<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Asistente de Escritura Académica – Editor</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --bg-primary: #fafafa;
            --bg-surface: #ffffff;
            --border: #e0e0e0;
            --text-primary: #212529;
            --muted: #6c757d;
            --badge-bg: #e9ecef;
            --badge-hover: #dde2e6;
            --accent: #0d6efd;
        }

        * { box-sizing: border-box; margin:0; padding:0; }
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        header {
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border);
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            flex-wrap: wrap;
        }
        .header-actions {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .settings-btn {
            background: var(--badge-bg);
            border: 1px solid var(--border);
            border-radius: 0.375rem;
            width: 2.25rem;
            height: 2.25rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 1.1rem;
            transition: background-color 0.2s ease, border-color 0.2s ease;
        }
        .settings-btn:hover {
            background: var(--badge-hover);
            border-color: #c9ced4;
        }
        .settings-status {
            font-size: 0.75rem;
            color: var(--muted);
        }
        .settings-status.ok { color: #198754; }
        .settings-status.warn { color: #b45309; }
        .settings-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.35);
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            z-index: 1000;
        }
        .settings-overlay.open { display: flex; }
        .settings-modal {
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: 0.75rem;
            width: 100%;
            max-width: 420px;
            padding: 1.25rem;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
        }
        .settings-modal h2 {
            font-size: 1.1rem;
            margin-bottom: 0.75rem;
        }
        .settings-modal label {
            display: block;
            font-size: 0.875rem;
            font-weight: 600;
            margin-bottom: 0.35rem;
        }
        .settings-modal input,
        .settings-modal select {
            width: 100%;
            border: 1px solid var(--border);
            border-radius: 0.375rem;
            padding: 0.6rem 0.75rem;
            font-size: 0.95rem;
            margin-bottom: 0.75rem;
            background: var(--bg-surface);
        }
        .settings-modal input:focus,
        .settings-modal select:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 0.2rem rgba(13,110,253,.25);
        }
        .settings-help {
            font-size: 0.8rem;
            color: var(--muted);
            margin-bottom: 1rem;
            line-height: 1.45;
        }
        .settings-actions {
            display: flex;
            justify-content: flex-end;
            gap: 0.5rem;
        }
        .btn {
            border: 1px solid var(--border);
            border-radius: 0.375rem;
            padding: 0.45rem 0.9rem;
            font-size: 0.875rem;
            cursor: pointer;
            background: var(--bg-surface);
        }
        .btn-primary {
            background: var(--accent);
            border-color: var(--accent);
            color: #fff;
        }
        .settings-feedback {
            font-size: 0.85rem;
            margin-bottom: 0.75rem;
            min-height: 1.2rem;
        }
        .settings-feedback.ok { color: #198754; }
        .settings-feedback.err { color: #b02a37; }
        .badge {
            background: var(--badge-bg);
            color: var(--text-primary);
            border-radius: 0.375rem;
            padding: 0.25rem 0.5rem;
            font-size: 0.875rem;
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            cursor: default;
            user-select: none;
            transition: background-color 0.2s ease;
        }
        .badge:hover { background: var(--badge-hover); }
        .badge-icon { font-size: 1rem; }
        main {
            flex: 1;
            display: flex;
            overflow: hidden;
            padding: 1rem;
            gap: 1rem;
        }
        #editor {
            flex: 2 1 0;
            min-width: 0;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: 0.5rem;
            padding: 1rem;
            overflow: auto;
            resize: none;
            font-size: 1rem;
            line-height: 1.6;
        }
        #editor:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 0.2rem rgba(13,110,253,.25); }
        aside {
            flex: 1 1 300px;
            min-width: 260px;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: 0.5rem;
            padding: 1rem;
            overflow: auto;
        }
        footer {
            background: var(--bg-surface);
            border-top: 1px solid var(--border);
            text-align: center;
            padding: 0.75rem 1rem;
            font-size: 0.875rem;
            color: var(--muted);
        }
        @media (max-width: 768px) {
            header { flex-direction: column; align-items: flex-start; gap: 0.5rem; }
            main { flex-direction: column; }
        }
        /* Estilos para el panel de aprendizaje */
        .suggestion-card {
            background: var(--badge-bg);
            border-radius: 0.5rem;
            padding: 1rem;
            margin-top: 0.5rem;
            border-left: 4px solid var(--accent);
        }
        .suggestion-card h3 {
            font-size: 0.9rem;
            color: var(--muted);
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .suggestion-card p {
            white-space: pre-wrap;
            line-height: 1.6;
        }
        .error-message {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-top: 0.5rem;
        }
        .loading-message {
            color: var(--muted);
            font-style: italic;
            padding: 0.5rem 0;
        }
        .editor-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
            flex-wrap: wrap;
        }
        .editor-toolbar label {
            font-weight: 600;
            margin: 0;
        }
        .btn-upload {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            background: var(--badge-bg);
            border: 1px solid var(--border);
            border-radius: 0.375rem;
            padding: 0.4rem 0.75rem;
            font-size: 0.875rem;
            cursor: pointer;
            transition: background-color 0.2s ease, border-color 0.2s ease;
        }
        .btn-upload:hover {
            background: var(--badge-hover);
            border-color: #c9ced4;
        }
        .btn-upload:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .context-bar {
            display: flex;
            gap: 0.75rem;
            margin-bottom: 0.75rem;
            flex-wrap: wrap;
        }
        .context-field {
            flex: 1 1 200px;
            min-width: 0;
        }
        .context-field label {
            display: block;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--muted);
            margin-bottom: 0.25rem;
        }
        .context-field select {
            width: 100%;
            border: 1px solid var(--border);
            border-radius: 0.375rem;
            padding: 0.45rem 0.6rem;
            font-size: 0.875rem;
            background: var(--bg-surface);
            color: var(--text-primary);
        }
        .context-field select:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 0.2rem rgba(13,110,253,.25);
        }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
</head>
<body>
<header>
    <h1 style="font-size:1.25rem; margin:0;">Asistente de Escritura Académica</h1>
    <div class="badges">
        <span class="badge" title="Fuente de datos"><span class="badge-icon">🔒</span> Fuente de datos</span>
        <span class="badge" title="Base normativa"><span class="badge-icon">📚</span> Base normativa</span>
        <span class="badge" title="Evaluación de intención"><span class="badge-icon">⚖️</span> Evaluación de intención</span>
        <span class="badge" title="Sugerencia ética"><span class="badge-icon">💡</span> Sugerencia ética</span>
    </div>
    <div class="header-actions">
        <span id="settings-status" class="settings-status warn">API Key: sin configurar</span>
        <button id="settings-btn" class="settings-btn" type="button" title="Configuración" aria-label="Configuración">⚙️</button>
    </div>
</header>

<div id="settings-overlay" class="settings-overlay" aria-hidden="true">
    <div class="settings-modal" role="dialog" aria-labelledby="settings-title">
        <h2 id="settings-title">Configuración</h2>
        <p class="settings-help">
            Configurá tu API Key y el modelo LLM de <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</a>.
            Todo se guarda en <code>.env</code> y queda activo al instante.
        </p>
        <label for="openrouter-key">OpenRouter API Key</label>
        <input id="openrouter-key" type="password" placeholder="sk-or-v1-... (dejá vacío para mantener la actual)" autocomplete="off">
        <label for="openrouter-model">Modelo LLM</label>
        <input id="openrouter-model" type="text" list="model-suggestions" placeholder="openrouter/owl-alpha" autocomplete="off">
        <datalist id="model-suggestions">
            <option value="openrouter/owl-alpha"></option>
            <option value="anthropic/claude-sonnet-4"></option>
            <option value="anthropic/claude-3.5-sonnet"></option>
            <option value="openai/gpt-4o-mini"></option>
            <option value="google/gemini-2.5-flash-preview"></option>
            <option value="meta-llama/llama-3.3-70b-instruct"></option>
            <option value="mistralai/mistral-small-3.1-24b-instruct"></option>
        </datalist>
        <div id="settings-feedback" class="settings-feedback"></div>
        <div class="settings-actions">
            <button id="settings-cancel" class="btn" type="button">Cancelar</button>
            <button id="settings-save" class="btn btn-primary" type="button">Guardar</button>
        </div>
    </div>
</div>

<main>
    <section>
        <div class="editor-toolbar">
            <label for="editor">Editor de texto</label>
            <button id="upload-btn" class="btn-upload" type="button">📎 Subir Documento</button>
        </div>
        <input type="file" id="file-upload" accept=".txt,.md,.pdf,.docx" style="display:none;">
        <div class="context-bar">
            <div class="context-field">
                <label for="norma-select">Normativa</label>
                <select id="norma-select">
                    <option value="APA 7ª ed." selected>APA 7ª ed.</option>
                    <option value="MLA 9ª ed.">MLA 9ª ed.</option>
                    <option value="Chicago 17ª">Chicago 17ª</option>
                    <option value="Vancouver">Vancouver</option>
                </select>
            </div>
            <div class="context-field">
                <label for="nivel-select">Nivel Académico</label>
                <select id="nivel-select">
                    <option value="Trabajo de Grado" selected>Trabajo de Grado</option>
                    <option value="Trabajo Final de Grado">Trabajo Final de Grado</option>
                    <option value="Ensayo Universitario">Ensayo Universitario</option>
                    <option value="Trabajo de Especialización de Posgrado">Trabajo de Especialización de Posgrado</option>
                    <option value="Trabajo de Maestría">Trabajo de Maestría</option>
                    <option value="Tesis de Maestría">Tesis de Maestría</option>
                    <option value="Trabajo de Doctorado">Trabajo de Doctorado</option>
                    <option value="Tesis de Doctorado">Tesis de Doctorado</option>
                    <option value="Trabajo de Postdoctorado">Trabajo de Postdoctorado</option>
                    <option value="Tesis de Postdoctorado">Tesis de Postdoctorado</option>
                    <option value="Artículo Científico">Artículo Científico</option>
                </select>
            </div>
        </div>
        <textarea id="editor" placeholder="Escriba su texto aquí…" rows="10"></textarea>
    </section>
    <aside>
        <h2 style="margin-bottom:0.5rem; font-size:1.1rem;">Panel de aprendizaje</h2>
        <div id="learning-panel">
            <p>Seleccione una sugerencia en el editor para ver su explicación aquí.</p>
        </div>
    </aside>
</main>

<footer>
    © 2026 Asistente de Escritura Académica – Todos los derechos reservados.
</footer>

<script>
    (function () {
        const editor = document.getElementById('editor');
        const learningPanel = document.getElementById('learning-panel');
        const settingsBtn = document.getElementById('settings-btn');
        const settingsOverlay = document.getElementById('settings-overlay');
        const settingsCancel = document.getElementById('settings-cancel');
        const settingsSave = document.getElementById('settings-save');
        const settingsStatus = document.getElementById('settings-status');
        const settingsFeedback = document.getElementById('settings-feedback');
        const openrouterKeyInput = document.getElementById('openrouter-key');
        const openrouterModelInput = document.getElementById('openrouter-model');
        const uploadBtn = document.getElementById('upload-btn');
        const fileUpload = document.getElementById('file-upload');
        const normaSelect = document.getElementById('norma-select');
        const nivelSelect = document.getElementById('nivel-select');
        let debounceTimer = null;
        let currentConfig = { configured: false, maskedKey: null, model: 'openrouter/owl-alpha' };
        const DEBOUNCE_MS = 500;

        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        function setSettingsStatus(configured, maskedKey, model) {
            const modelLabel = model ? ` · ${model}` : '';
            if (configured) {
                settingsStatus.textContent = maskedKey
                    ? `API Key: ${maskedKey}${modelLabel}`
                    : `API Key: configurada${modelLabel}`;
                settingsStatus.className = 'settings-status ok';
            } else {
                settingsStatus.textContent = `API Key: sin configurar${modelLabel}`;
                settingsStatus.className = 'settings-status warn';
            }
        }

        function openSettings() {
            settingsFeedback.textContent = '';
            settingsFeedback.className = 'settings-feedback';
            openrouterKeyInput.value = '';
            openrouterModelInput.value = currentConfig.model || 'openrouter/owl-alpha';
            settingsOverlay.classList.add('open');
            settingsOverlay.setAttribute('aria-hidden', 'false');
            (currentConfig.configured ? openrouterModelInput : openrouterKeyInput).focus();
        }

        function closeSettings() {
            settingsOverlay.classList.remove('open');
            settingsOverlay.setAttribute('aria-hidden', 'true');
        }

        async function loadConfigStatus() {
            try {
                const response = await fetch('/api/config');
                const data = await response.json().catch(() => ({}));
                if (response.ok) {
                    currentConfig = {
                        configured: data.configured,
                        maskedKey: data.maskedKey,
                        model: data.model || data.defaultModel || 'openrouter/owl-alpha',
                    };
                    setSettingsStatus(currentConfig.configured, currentConfig.maskedKey, currentConfig.model);
                }
            } catch (error) {
                console.error('Error al cargar configuración:', error);
            }
        }

        async function saveConfig() {
            const openRouterApiKey = openrouterKeyInput.value.trim();
            const openRouterModel = openrouterModelInput.value.trim();

            if (!openRouterModel) {
                settingsFeedback.textContent = 'Ingresá un modelo LLM válido.';
                settingsFeedback.className = 'settings-feedback err';
                return;
            }

            if (!openRouterApiKey && !currentConfig.configured) {
                settingsFeedback.textContent = 'Ingresá una API Key para la primera configuración.';
                settingsFeedback.className = 'settings-feedback err';
                return;
            }

            settingsSave.disabled = true;
            settingsFeedback.textContent = 'Guardando…';
            settingsFeedback.className = 'settings-feedback';

            try {
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ openRouterApiKey, openRouterModel })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    const detail = data.details
                        ? (Array.isArray(data.details) ? data.details.join(' ') : String(data.details))
                        : '';
                    settingsFeedback.textContent = data.error
                        ? `${data.error}${detail ? ` — ${detail}` : ''}`
                        : 'No se pudo guardar la configuración.';
                    settingsFeedback.className = 'settings-feedback err';
                    return;
                }

                settingsFeedback.textContent = data.message || 'Configuración guardada.';
                settingsFeedback.className = 'settings-feedback ok';
                currentConfig = {
                    configured: data.configured,
                    maskedKey: data.maskedKey,
                    model: data.model || openRouterModel,
                };
                setSettingsStatus(currentConfig.configured, currentConfig.maskedKey, currentConfig.model);
                openrouterKeyInput.value = '';

                setTimeout(closeSettings, 900);
            } catch (error) {
                settingsFeedback.textContent = error.message || 'Error al guardar la configuración.';
                settingsFeedback.className = 'settings-feedback err';
            } finally {
                settingsSave.disabled = false;
            }
        }

        function showLoading(message) {
            learningPanel.innerHTML = `<p class="loading-message">${escapeHtml(message || 'Analizando texto…')}</p>`;
        }

        function showError(message) {
            learningPanel.innerHTML = `<div class="error-message"><strong>Error:</strong> ${escapeHtml(message)}</div>`;
        }

        function showSuggestion(suggestion) {
            learningPanel.innerHTML = `
                <div class="suggestion-card">
                    <h3>Sugerencia</h3>
                    <p>${escapeHtml(suggestion)}</p>
                </div>
            `;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        async function fetchSuggestion(text) {
            try {
                const response = await fetch('/api/suggest', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text,
                        norma: normaSelect.value,
                        nivel: nivelSelect.value,
                    })
                });

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    const detail = data.details
                        ? (Array.isArray(data.details) ? data.details.join(' ') : String(data.details))
                        : '';
                    const message = data.error
                        ? `${data.error}${detail ? ` — ${detail}` : ''}`
                        : `Error del servidor: ${response.status} ${response.statusText}`;
                    showError(message);
                    return;
                }

                if (data.redirect && data.message) {
                    showSuggestion(data.message);
                } else if (data.suggestion || data.suggested) {
                    showSuggestion(data.suggestion || data.suggested);
                } else {
                    learningPanel.innerHTML = '<p>No hay sugerencias disponibles para este texto.</p>';
                }
            } catch (error) {
                console.error('Error al obtener sugerencia:', error);
                showError(error.message || 'No se pudo obtener la sugerencia. Intente nuevamente más tarde.');
            }
        }

        settingsBtn.addEventListener('click', openSettings);
        settingsCancel.addEventListener('click', closeSettings);
        settingsSave.addEventListener('click', saveConfig);
        settingsOverlay.addEventListener('click', function (event) {
            if (event.target === settingsOverlay) closeSettings();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && settingsOverlay.classList.contains('open')) {
                closeSettings();
            }
        });

        function analyzeEditorContent() {
            clearTimeout(debounceTimer);
            const text = editor.value.trim();

            if (!text) {
                learningPanel.innerHTML = '<p>Seleccione una sugerencia en el editor para ver su explicación aquí.</p>';
                return;
            }

            showLoading();

            debounceTimer = setTimeout(() => {
                fetchSuggestion(text);
            }, DEBOUNCE_MS);
        }

        function readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('No se pudo leer el archivo de texto.'));
                reader.readAsText(file);
            });
        }

        function readFileAsArrayBuffer(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
                reader.readAsArrayBuffer(file);
            });
        }

        async function extractPdfText(arrayBuffer) {
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('PDF.js no está disponible. Verificá tu conexión a internet.');
            }

            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const parts = [];

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
                const page = await pdf.getPage(pageNum);
                const content = await page.getTextContent();
                const pageText = content.items.map((item) => item.str).join(' ');
                parts.push(pageText);
            }

            return parts.join('\n\n').trim();
        }

        async function extractDocxText(arrayBuffer) {
            if (typeof mammoth === 'undefined') {
                throw new Error('Mammoth.js no está disponible. Verificá tu conexión a internet.');
            }

            const result = await mammoth.extractRawText({ arrayBuffer });
            return (result.value || '').trim();
        }

        function getFileExtension(fileName) {
            const dot = fileName.lastIndexOf('.');
            return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
        }

        function mapExtractionError(error, extension) {
            const message = (error && error.message) ? error.message : String(error);

            if (/password|encrypted|contraseña/i.test(message)) {
                return `El ${extension.toUpperCase()} está protegido con contraseña. Subí una versión sin encriptar.`;
            }

            if (/invalid|corrupt|damaged|format/i.test(message)) {
                return `El archivo ${extension.toUpperCase()} está corrupto o no es válido.`;
            }

            return `No se pudo extraer texto del ${extension.toUpperCase()}: ${message}`;
        }

        async function handleFileUpload(file) {
            const extension = getFileExtension(file.name);

            if (!['.txt', '.md', '.pdf', '.docx'].includes(extension)) {
                showError('Formato no soportado. Usá .txt, .md, .pdf o .docx.');
                return;
            }

            uploadBtn.disabled = true;
            showLoading('Cargando y extrayendo texto del documento...');

            try {
                let extractedText = '';

                if (extension === '.txt' || extension === '.md') {
                    extractedText = (await readFileAsText(file)).trim();
                } else if (extension === '.pdf') {
                    const arrayBuffer = await readFileAsArrayBuffer(file);
                    extractedText = await extractPdfText(arrayBuffer);
                } else if (extension === '.docx') {
                    const arrayBuffer = await readFileAsArrayBuffer(file);
                    extractedText = await extractDocxText(arrayBuffer);
                }

                if (!extractedText) {
                    showError(`El archivo ${extension.toUpperCase()} no contiene texto extraíble. Puede estar escaneado, vacío o protegido.`);
                    return;
                }

                editor.value = extractedText;
                analyzeEditorContent();
            } catch (error) {
                console.error('Error al procesar archivo:', error);
                showError(mapExtractionError(error, extension.replace('.', '')));
            } finally {
                uploadBtn.disabled = false;
                fileUpload.value = '';
            }
        }

        loadConfigStatus();

        uploadBtn.addEventListener('click', function () {
            fileUpload.click();
        });

        fileUpload.addEventListener('change', function () {
            const file = this.files && this.files[0];
            if (file) {
                handleFileUpload(file);
            }
        });

        editor.addEventListener('input', analyzeEditorContent);
        normaSelect.addEventListener('change', analyzeEditorContent);
        nivelSelect.addEventListener('change', analyzeEditorContent);
    })();
</script>
</body>
</html>