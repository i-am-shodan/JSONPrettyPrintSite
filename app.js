(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const input = $('input');
    const inputGutter = $('inputGutter');
    const output = $('output');
    const status = $('status');
    const pathDisplay = $('pathDisplay');
    const indentSelect = $('indentSelect');
    const sortKeysCb = $('sortKeys');
    const fileInput = $('fileInput');

    let rawOutput = '';

    // ---------- Theme ----------
    const THEME_KEY = 'jpp-theme';
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* ignore */ }
    }
    (function initTheme() {
        let saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* ignore */ }
        if (saved === 'dark' || saved === 'light') { applyTheme(saved); return; }
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    })();
    $('themeToggle').addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // ---------- Status ----------
    function setStatus(message, kind) {
        status.textContent = message || '';
        status.className = 'status' + (kind ? ' ' + kind : '');
    }

    // ---------- HTML escaping ----------
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => (
            c === '&' ? '&amp;' :
            c === '<' ? '&lt;' :
            c === '>' ? '&gt;' :
            c === '"' ? '&quot;' : '&#39;'
        ));
    }
    const escapeAttr = escapeHtml;

    // ---------- JSON path formatting (jq-style) ----------
    const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
    function appendKeyToPath(path, key) {
        return IDENT_RE.test(key) ? path + '.' + key : path + '[' + JSON.stringify(key) + ']';
    }
    function appendIndexToPath(path, i) { return path + '[' + i + ']'; }

    // ---------- Simple highlighter (used for minified single-line output) ----------
    const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}\[\],:])/g;
    function highlightInline(text) {
        let out = '';
        let last = 0;
        let m;
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(text)) !== null) {
            if (m.index > last) out += escapeHtml(text.slice(last, m.index));
            if (m[1] !== undefined) {
                if (m[2]) {
                    out += '<span class="tok-key">' + escapeHtml(m[1]) + '</span>'
                         + '<span class="tok-punct">' + escapeHtml(m[2]) + '</span>';
                } else {
                    out += '<span class="tok-string">' + escapeHtml(m[1]) + '</span>';
                }
            } else if (m[3] !== undefined) {
                out += '<span class="tok-number">' + escapeHtml(m[3]) + '</span>';
            } else if (m[4] !== undefined) {
                out += '<span class="tok-bool">' + escapeHtml(m[4]) + '</span>';
            } else if (m[5] !== undefined) {
                out += '<span class="tok-null">' + escapeHtml(m[5]) + '</span>';
            } else if (m[6] !== undefined) {
                out += '<span class="tok-punct">' + escapeHtml(m[6]) + '</span>';
            }
            last = m.index + m[0].length;
        }
        if (last < text.length) out += escapeHtml(text.slice(last));
        return out;
    }

    // ---------- Structured renderer (pretty-printed view) ----------
    function tokenForPrimitive(value) {
        if (value === null) return '<span class="tok-null">null</span>';
        switch (typeof value) {
            case 'string': return '<span class="tok-string">' + escapeHtml(JSON.stringify(value)) + '</span>';
            case 'number': return '<span class="tok-number">' + escapeHtml(Number.isFinite(value) ? String(value) : 'null') + '</span>';
            case 'boolean': return '<span class="tok-bool">' + (value ? 'true' : 'false') + '</span>';
            default: return '<span class="tok-string">' + escapeHtml(JSON.stringify(String(value))) + '</span>';
        }
    }

    function makeRenderer(indentStr) {
        let lineNo = 0;
        let bid = 0;

        function nextLine() { return ++lineNo; }
        function nextBid() { return ++bid; }

        function renderLine(opts) {
            const n = nextLine();
            const path = opts.path || '';
            const toggle = opts.foldBid
                ? '<button type="button" class="fold-toggle" data-bid="' + opts.foldBid + '" aria-label="Toggle fold"></button>'
                : '<span class="fold-toggle empty"></span>';
            return '<div class="line" data-line="' + n + '" data-path="' + escapeAttr(path) + '">'
                 + '<span class="ln">' + n + '</span>'
                 + toggle
                 + '<span class="code">' + opts.code + '</span>'
                 + '</div>';
        }

        function indentSpan(level) {
            if (level <= 0) return '';
            return '<span class="indent">' + escapeHtml(indentStr.repeat(level)) + '</span>';
        }

        function keyPrefixHtml(key) {
            return '<span class="tok-key">' + escapeHtml(JSON.stringify(key)) + '</span>'
                 + '<span class="tok-punct">: </span>';
        }

        function trailHtml(hasTrailing) {
            return hasTrailing ? '<span class="tok-punct">,</span>' : '';
        }

        function summaryHtml(closeChar, bidVal, count, isArray, hasTrailing) {
            const label = isArray
                ? (count === 1 ? '1 item' : count + ' items')
                : (count === 1 ? '1 key' : count + ' keys');
            return '<span class="fold-summary">'
                 + ' \u2026 '
                 + '<span class="bracket tok-punct" data-bid="' + bidVal + '">' + closeChar + '</span>'
                 + trailHtml(hasTrailing)
                 + '<span class="fold-count">// ' + label + '</span>'
                 + '</span>';
        }

        // Recursively render a value into HTML lines.
        // - level: indentation level (number of indent units before the value)
        // - path: current json path string (e.g. "$.items[2]")
        // - keyHtml: HTML to prepend before the value (object key + ": ", or '' for array elements / root)
        // - hasTrailing: whether this value should have a trailing comma
        function render(value, level, path, keyHtml, hasTrailing) {
            const indent = indentSpan(level);

            // Primitives
            if (value === null || typeof value !== 'object') {
                return renderLine({
                    path,
                    code: indent + (keyHtml || '') + tokenForPrimitive(value) + trailHtml(hasTrailing)
                });
            }

            const isArray = Array.isArray(value);
            const open = isArray ? '[' : '{';
            const close = isArray ? ']' : '}';
            const entries = isArray
                ? value.map((v, i) => [i, v])
                : Object.keys(value).map((k) => [k, value[k]]);
            const count = entries.length;

            // Empty container -> single line
            if (count === 0) {
                const inlineBid = nextBid();
                const code = indent
                    + (keyHtml || '')
                    + '<span class="bracket tok-punct" data-bid="' + inlineBid + '">' + open + '</span>'
                    + '<span class="bracket tok-punct" data-bid="' + inlineBid + '">' + close + '</span>'
                    + trailHtml(hasTrailing);
                return renderLine({ path, code });
            }

            const myBid = nextBid();

            // Open line: indent + key + '{' + fold-summary
            const openCode = indent
                + (keyHtml || '')
                + '<span class="bracket tok-punct" data-bid="' + myBid + '">' + open + '</span>'
                + summaryHtml(close, myBid, count, isArray, hasTrailing);
            const openLine = renderLine({ path, code: openCode, foldBid: myBid });

            // Body
            const bodyParts = [];
            for (let i = 0; i < count; i++) {
                const [k, v] = entries[i];
                const childPath = isArray ? appendIndexToPath(path, k) : appendKeyToPath(path, k);
                const childKey = isArray ? '' : keyPrefixHtml(k);
                const childTrailing = i < count - 1;
                bodyParts.push(render(v, level + 1, childPath, childKey, childTrailing));
            }

            // Close line: indent + '}' + trailing comma
            const closeCode = indent
                + '<span class="bracket tok-punct" data-bid="' + myBid + '">' + close + '</span>'
                + trailHtml(hasTrailing);
            const closeLine = renderLine({ path, code: closeCode });

            return '<div class="block" data-bid="' + myBid + '" data-path="' + escapeAttr(path) + '">'
                 + openLine
                 + '<div class="block-body">' + bodyParts.join('') + '</div>'
                 + closeLine
                 + '</div>';
        }

        return { render };
    }

    function renderPretty(value, indentStr) {
        const r = makeRenderer(indentStr);
        return r.render(value, 0, '$', '', false);
    }

    function renderMinified(text) {
        // Single line containing the inline-highlighted minified JSON.
        return '<div class="line" data-line="1" data-path="$">'
             + '<span class="ln">1</span>'
             + '<span class="fold-toggle empty"></span>'
             + '<span class="code">' + highlightInline(text) + '</span>'
             + '</div>';
    }

    function setOutput(html, rawText) {
        rawOutput = rawText || '';
        output.innerHTML = html || '';
        clearMatchedBrackets();
        clearActivePath();
        setPathDisplay('');
    }

    // ---------- Parse with friendly error location ----------
    function parseJSON(text) {
        try {
            return { ok: true, value: JSON.parse(text) };
        } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            const loc = locateError(text, msg);
            return { ok: false, error: msg, loc };
        }
    }
    function locateError(text, msg) {
        const posMatch = msg.match(/at position (\d+)/i);
        if (posMatch) return offsetToLineCol(text, parseInt(posMatch[1], 10));
        const lcMatch = msg.match(/line (\d+) column (\d+)/i);
        if (lcMatch) return { line: parseInt(lcMatch[1], 10), col: parseInt(lcMatch[2], 10), pos: -1 };
        return null;
    }
    function offsetToLineCol(text, offset) {
        let line = 1, col = 1;
        const len = Math.min(offset, text.length);
        for (let i = 0; i < len; i++) {
            if (text.charCodeAt(i) === 10) { line++; col = 1; } else { col++; }
        }
        return { line, col, pos: offset };
    }
    function describeError(err, loc) {
        if (!loc) return 'Invalid JSON: ' + err;
        if (loc.pos >= 0) return `Invalid JSON: ${err}\n  -> line ${loc.line}, column ${loc.col} (offset ${loc.pos})`;
        return `Invalid JSON: ${err}\n  -> line ${loc.line}, column ${loc.col}`;
    }
    function selectError(loc) {
        if (!loc || loc.pos == null || loc.pos < 0) return;
        try {
            input.focus();
            input.setSelectionRange(loc.pos, Math.min(loc.pos + 1, input.value.length));
        } catch (_) { /* ignore */ }
    }

    // ---------- Indent + sorting ----------
    function getIndent() {
        const v = indentSelect.value;
        if (v === 'tab') return '\t';
        const n = parseInt(v, 10);
        return ' '.repeat(Number.isFinite(n) && n > 0 ? n : 2);
    }
    function sortObjectKeys(value) {
        if (Array.isArray(value)) return value.map(sortObjectKeys);
        if (value && typeof value === 'object') {
            const out = {};
            Object.keys(value).sort().forEach((k) => { out[k] = sortObjectKeys(value[k]); });
            return out;
        }
        return value;
    }

    // ---------- Actions ----------
    function prettyPrint(opts) {
        const interactive = !!(opts && opts.interactive);
        const text = input.value;
        if (!text.trim()) { setStatus('', ''); setOutput('', ''); return; }
        const r = parseJSON(text);
        if (!r.ok) {
            setStatus(describeError(r.error, r.loc), 'error');
            if (interactive) selectError(r.loc);
            return;
        }
        const value = sortKeysCb.checked ? sortObjectKeys(r.value) : r.value;
        const indentStr = getIndent();
        const formatted = JSON.stringify(value, null, indentStr);
        const html = renderPretty(value, indentStr);
        setOutput(html, formatted);
        setStatus(`Valid JSON. ${formatBytes(byteLength(formatted))} formatted.`, 'success');
    }

    function minify() {
        const text = input.value;
        if (!text.trim()) { setStatus('Input is empty.', 'info'); setOutput('', ''); return; }
        const r = parseJSON(text);
        if (!r.ok) { setOutput('', ''); setStatus(describeError(r.error, r.loc), 'error'); selectError(r.loc); return; }
        const value = sortKeysCb.checked ? sortObjectKeys(r.value) : r.value;
        const minified = JSON.stringify(value);
        setOutput(renderMinified(minified), minified);
        setStatus(`Valid JSON. Minified to ${formatBytes(byteLength(minified))}.`, 'success');
    }

    function validate() {
        const text = input.value;
        if (!text.trim()) { setStatus('Input is empty.', 'info'); return; }
        const r = parseJSON(text);
        if (!r.ok) { setStatus(describeError(r.error, r.loc), 'error'); selectError(r.loc); return; }
        setStatus(`Valid JSON. ${formatBytes(byteLength(text))} input.`, 'success');
    }

    function clearAll() {
        input.value = '';
        updateInputGutter();
        setOutput('', '');
        setStatus('', '');
        input.focus();
    }

    function loadSample() {
        input.value = JSON.stringify({
            name: "JSON Pretty Print",
            version: "1.0.0",
            clientSide: true,
            features: ["pretty-print", "minify", "validate", "sort-keys"],
            stats: { stars: 0, forks: 0, users: 1 },
            example: {
                nested: { array: [1, 2, 3, { deep: true }], nullable: null },
                unicode: "héllo \u2728"
            }
        });
        updateInputGutter();
        prettyPrint();
    }

    async function pasteFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            setStatus('Clipboard access is not available in this browser. Use Ctrl/Cmd+V.', 'error');
            return;
        }
        try {
            const text = await navigator.clipboard.readText();
            input.value = text;
            updateInputGutter();
            prettyPrint();
        } catch (e) {
            setStatus('Could not read clipboard: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    async function copyOutput() {
        if (!rawOutput) { setStatus('Nothing to copy.', 'info'); return; }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(rawOutput);
            } else {
                const ta = document.createElement('textarea');
                ta.value = rawOutput;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setStatus('Output copied to clipboard.', 'success');
        } catch (e) {
            setStatus('Copy failed: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    function downloadOutput() {
        if (!rawOutput) { setStatus('Nothing to download.', 'info'); return; }
        const blob = new Blob([rawOutput], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'formatted.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function handleFile(file) {
        if (!file) return;
        const MAX = 20 * 1024 * 1024;
        if (file.size > MAX) {
            setStatus(`File too large (${formatBytes(file.size)}). Max ${formatBytes(MAX)}.`, 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => { input.value = String(reader.result || ''); updateInputGutter(); prettyPrint(); };
        reader.onerror = () => setStatus('Failed to read file.', 'error');
        reader.readAsText(file);
    }

    // ---------- Folding ----------
    function expandAll() {
        output.querySelectorAll('.block.collapsed').forEach((el) => el.classList.remove('collapsed'));
    }
    function collapseAll() {
        // Collapse every block except the very root, so the user can still see something.
        const blocks = output.querySelectorAll('.block');
        blocks.forEach((el, i) => { if (i > 0) el.classList.add('collapsed'); });
    }

    // ---------- Bracket matching + path display ----------
    function clearMatchedBrackets() {
        output.querySelectorAll('.bracket.matched').forEach((el) => el.classList.remove('matched'));
    }
    function clearActivePath() {
        output.querySelectorAll('.line.path-active').forEach((el) => el.classList.remove('path-active'));
    }
    function setPathDisplay(path) {
        pathDisplay.textContent = path || '';
        pathDisplay.classList.remove('copied');
    }

    output.addEventListener('click', (e) => {
        // 1) Fold toggle has its own behavior.
        const toggle = e.target.closest('.fold-toggle');
        if (toggle && !toggle.classList.contains('empty')) {
            const block = toggle.closest('.block');
            if (block) block.classList.toggle('collapsed');
            e.stopPropagation();
            return;
        }

        clearMatchedBrackets();
        clearActivePath();

        // 2) Bracket matching: bracket clicked directly, OR nearest enclosing block.
        let bid = null;
        const bracket = e.target.closest('.bracket');
        if (bracket) {
            bid = bracket.getAttribute('data-bid');
        } else {
            const block = e.target.closest('.block');
            if (block) bid = block.getAttribute('data-bid');
        }
        if (bid) {
            output
                .querySelectorAll('.bracket[data-bid="' + bid + '"]')
                .forEach((el) => el.classList.add('matched'));
        }

        // 3) Path display: take the data-path of the nearest line.
        const line = e.target.closest('.line');
        if (line) {
            line.classList.add('path-active');
            setPathDisplay(line.getAttribute('data-path') || '');
        }
    });

    pathDisplay.addEventListener('click', async () => {
        const text = pathDisplay.textContent;
        if (!text) return;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                pathDisplay.classList.add('copied');
                setStatus('Path copied: ' + text, 'success');
            }
        } catch (_) { /* ignore */ }
    });

    // ---------- Utilities ----------
    function byteLength(str) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
        return str.length;
    }
    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // ---------- Wire up ----------
    $('formatBtn').addEventListener('click', () => prettyPrint({ interactive: true }));
    $('minifyBtn').addEventListener('click', minify);
    $('validateBtn').addEventListener('click', validate);
    $('clearBtn').addEventListener('click', clearAll);
    $('sampleBtn').addEventListener('click', loadSample);
    $('pasteBtn').addEventListener('click', pasteFromClipboard);
    $('copyBtn').addEventListener('click', copyOutput);
    $('downloadBtn').addEventListener('click', downloadOutput);
    $('expandAllBtn').addEventListener('click', expandAll);
    $('collapseAllBtn').addEventListener('click', collapseAll);

    $('loadFileBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        handleFile(file);
        fileInput.value = '';
    });

    // Drag & drop into input.
    ['dragover', 'dragenter'].forEach((evt) =>
        input.addEventListener(evt, (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; })
    );
    input.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // Ctrl/Cmd + Enter formats and reports errors interactively.
    input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            prettyPrint({ interactive: true });
        }
    });

    // Live pretty-print + validate as the user types (debounced).
    let liveTimer = null;
    function scheduleLiveFormat() {
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = setTimeout(prettyPrint, 150);
    }
    input.addEventListener('input', scheduleLiveFormat);
    indentSelect.addEventListener('change', prettyPrint);
    sortKeysCb.addEventListener('change', prettyPrint);

    // ---------- Input gutter (line numbers) ----------
    function updateInputGutter() {
        const lines = input.value.length === 0 ? 1 : input.value.split('\n').length;
        // Build "1\n2\n3\n..." as text content; CSS `white-space: pre` preserves the newlines.
        let s = '';
        for (let i = 1; i <= lines; i++) s += i + '\n';
        inputGutter.textContent = s;
        inputGutter.scrollTop = input.scrollTop;
    }
    input.addEventListener('input', updateInputGutter);
    input.addEventListener('scroll', () => { inputGutter.scrollTop = input.scrollTop; });
    window.addEventListener('resize', updateInputGutter);
    updateInputGutter();

    setStatus('Ready. Paste or type JSON — it validates and formats as you go.', 'info');
})();
