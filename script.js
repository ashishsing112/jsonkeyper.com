/* JSON Keyper - key extraction, path formatting and structure analysis.
   Everything runs in the browser; no JSON is ever sent to a server. */

var lastNodes = null;
var lastRoot = null;
var lastInput = '';
// Why the last input has no key paths (a bare scalar, or {} / []), or null.
// Formatting still works on such input; only the key-based formats refuse it.
var lastNoKeysReason = null;

function getType(obj) {
    if (Array.isArray(obj)) {
        return 'array';
    } else if (obj === null) {
        return 'null';
    } else {
        return typeof obj;
    }
}

/* ---------------------------------------------------------------------------
   Traversal
   Produces one node per object key. Array indices are only walked through,
   never emitted on their own, so `tags: ["a","b"]` yields `tags` rather than
   `tags`, `tags[0]`, `tags[1]`.
--------------------------------------------------------------------------- */

function isBareKey(key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function analyze(root) {
    const nodes = [];
    const stats = { objects: 0, arrays: 0, maxDepth: 0, types: {} };

    function visit(value, path, jsonPath, depth) {
        const type = getType(value);
        if (depth > stats.maxDepth) {
            stats.maxDepth = depth;
        }
        if (type === 'object') {
            stats.objects++;
            for (const key of Object.keys(value)) {
                const child = value[key];
                const childType = getType(child);
                const childPath = path ? path + '.' + key : key;
                const childJsonPath = isBareKey(key)
                    ? jsonPath + '.' + key
                    : jsonPath + "['" + key.replace(/'/g, "\\'") + "']";
                nodes.push({
                    path: childPath,
                    jsonPath: childJsonPath,
                    key: key,
                    type: childType,
                    depth: depth + 1
                });
                stats.types[childType] = (stats.types[childType] || 0) + 1;
                visit(child, childPath, childJsonPath, depth + 1);
            }
        } else if (type === 'array') {
            stats.arrays++;
            for (let i = 0; i < value.length; i++) {
                visit(value[i], path + '[' + i + ']', jsonPath + '[' + i + ']', depth + 1);
            }
        }
    }

    visit(root, '', '$', 0);
    return { nodes: nodes, stats: stats };
}

function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
        if (!seen.has(item)) {
            seen.add(item);
            out.push(item);
        }
    }
    return out;
}

function collapseIndices(path) {
    return path.replace(/\[\d+\]/g, '[]');
}

/* ---------------------------------------------------------------------------
   Output formats
--------------------------------------------------------------------------- */

function formatPaths(nodes, collapse) {
    let paths = nodes.map(n => n.path);
    if (collapse) {
        paths = dedupe(paths.map(collapseIndices));
    }
    return paths.join('\n');
}

function formatTypedPaths(nodes, collapse) {
    let rows = nodes.map(n => ({ path: collapse ? collapseIndices(n.path) : n.path, type: n.type }));
    if (collapse) {
        const seen = new Set();
        rows = rows.filter(r => {
            const id = JSON.stringify([r.path, r.type]);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }
    const width = rows.reduce((max, r) => Math.max(max, r.path.length), 0);
    return rows.map(r => r.path.padEnd(width + 2) + r.type).join('\n');
}

function formatUniqueKeys(nodes) {
    return dedupe(nodes.map(n => n.key)).sort((a, b) => a.localeCompare(b)).join('\n');
}

function formatJsonPaths(nodes, collapse) {
    let paths = nodes.map(n => n.jsonPath);
    if (collapse) {
        paths = dedupe(paths.map(p => p.replace(/\[\d+\]/g, '[*]')));
    }
    return paths.join('\n');
}

/* The tree is a structural view, so array indices are always collapsed. Drawing
   one branch per element would bury the shape under repetition for any array
   longer than a couple of items. */
function formatTree(nodes) {
    const seen = new Set();
    const rows = [];
    for (const n of nodes) {
        const collapsed = collapseIndices(n.path);
        if (seen.has(collapsed)) {
            continue;
        }
        seen.add(collapsed);
        rows.push({
            key: n.key,
            type: n.type,
            depth: collapsed.split('.').length
        });
    }
    return rows.map(n => {
        const indent = '  '.repeat(Math.max(0, n.depth - 1));
        return indent + n.key + '  (' + n.type + ')';
    }).join('\n');
}

/* TypeScript interface generation. Every value seen at a position is kept, not
   just the first, so that objects inside an array merge into one shape: a key
   missing from some elements is emitted as optional, a key that is null in some
   elements gains `| null`, and nested arrays pool their elements. */

function mergeObjects(items) {
    const values = {};
    for (const item of items) {
        for (const key of Object.keys(item)) {
            (values[key] = values[key] || []).push(item[key]);
        }
    }
    const optional = new Set(Object.keys(values).filter(k => values[k].length < items.length));
    return { values: values, optional: optional };
}

function tsKeyName(key) {
    return isBareKey(key) ? key : JSON.stringify(key);
}

function tsObjectBody(values, optional, indent) {
    const keys = Object.keys(values);
    if (!keys.length) {
        return 'Record<string, never>';
    }
    const pad = '  '.repeat(indent + 1);
    const closePad = '  '.repeat(indent);
    const lines = keys.map(key => {
        const mark = optional.has(key) ? '?' : '';
        return pad + tsKeyName(key) + mark + ': ' + tsAlternatives(values[key], indent + 1).join(' | ') + ';';
    });
    return '{\n' + lines.join('\n') + '\n' + closePad + '}';
}

function tsArray(items, indent) {
    if (!items.length) {
        return 'unknown[]';
    }
    const inner = tsAlternatives(items, indent);
    return (inner.length === 1 ? inner[0] : '(' + inner.join(' | ') + ')') + '[]';
}

// The distinct types observed across a set of values at one position. Objects
// merge into a single shape and arrays pool their elements, so a position
// yields at most one object type and one array type.
function tsAlternatives(values, indent) {
    const objects = values.filter(v => getType(v) === 'object');
    const arrays = values.filter(v => getType(v) === 'array');
    const out = [];
    for (const value of values) {
        const type = getType(value);
        if (type === 'string' || type === 'number' || type === 'boolean') {
            out.push(type);
        }
    }
    if (objects.length) {
        const merged = mergeObjects(objects);
        out.push(tsObjectBody(merged.values, merged.optional, indent));
    }
    if (arrays.length) {
        out.push(tsArray([].concat(...arrays), indent));
    }
    if (values.some(v => v === null)) {
        out.push('null');
    }
    return dedupe(out);
}

function formatTypeScript(root) {
    if (getType(root) === 'array') {
        return 'type Root = ' + tsArray(root, 0) + ';';
    }
    return 'interface Root ' + tsObjectBody(mergeObjects([root]).values, new Set(), 0);
}

/* Pretty-printing and minifying work on the original text, not on the parsed
   value. Re-serialising with JSON.stringify would silently change the data:
   integers above 2^53 lose precision, 1.0 becomes 1, and duplicate keys
   collapse to the last one. Walking the text and changing only whitespace
   outside strings guarantees every value comes out exactly as it went in.
   The caller must have validated the text with JSON.parse first; the scans
   below rely on it (every string is closed, every bracket is matched). */
function formatJsonText(text, indent) {
    const newline = indent ? '\n' : '';
    const parts = [];
    let depth = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        switch (ch) {
            case ' ':
            case '\t':
            case '\n':
            case '\r':
                i++;
                break;
            case '"': {
                // Copy the whole string literal in one slice, skipping escapes, so
                // brackets, commas and colons inside strings are never touched.
                let j = i + 1;
                while (text[j] !== '"') {
                    j += text[j] === '\\' ? 2 : 1;
                }
                parts.push(text.slice(i, j + 1));
                i = j + 1;
                break;
            }
            case '{':
            case '[': {
                // An empty container stays on one line as {} or [].
                const close = ch === '{' ? '}' : ']';
                let j = i + 1;
                while (' \t\n\r'.includes(text[j])) {
                    j++;
                }
                if (text[j] === close) {
                    parts.push(ch + close);
                    i = j + 1;
                } else {
                    depth++;
                    parts.push(ch + newline + indent.repeat(depth));
                    i++;
                }
                break;
            }
            case '}':
            case ']':
                depth--;
                parts.push(newline + indent.repeat(depth) + ch);
                i++;
                break;
            case ',':
                parts.push(',' + newline + indent.repeat(depth));
                i++;
                break;
            case ':':
                parts.push(indent ? ': ' : ':');
                i++;
                break;
            default: {
                // A number, true, false or null: copy the run up to the next
                // structural character or whitespace unchanged.
                let j = i + 1;
                while (j < text.length && !',]} \t\n\r'.includes(text[j])) {
                    j++;
                }
                parts.push(text.slice(i, j));
                i = j;
            }
        }
    }
    return parts.join('');
}

// Output formats that re-emit the JSON itself, mapped to their indent string.
const TEXT_FORMATS = { pretty2: '  ', pretty4: '    ', minified: '' };

function isTextFormat(format) {
    return Object.prototype.hasOwnProperty.call(TEXT_FORMATS, format);
}

/* ---------------------------------------------------------------------------
   Rendering
--------------------------------------------------------------------------- */

function currentFormat() {
    const select = document.getElementById('outputFormat');
    return select ? select.value : 'paths';
}

// Landing pages deep-link into a specific output format, e.g. /?format=typescript.
// The select's own options are the source of truth, so adding a format needs no
// change here and an unknown value simply falls through to the default.
function applyFormatFromUrl(select) {
    const requested = new URLSearchParams(window.location.search).get('format');
    if (!requested) {
        return;
    }
    if (Array.from(select.options).some(option => option.value === requested)) {
        select.value = requested;
    }
}

// Collapsing array indices means nothing when the JSON itself is the output.
function syncControls() {
    const box = document.getElementById('collapseArrays');
    if (box) {
        box.disabled = isTextFormat(currentFormat());
    }
}

function collapseEnabled() {
    const box = document.getElementById('collapseArrays');
    return !!(box && box.checked);
}

function render() {
    if (!lastNodes) {
        return;
    }
    const format = currentFormat();
    if (isTextFormat(format)) {
        clearError();
        setOutput(formatJsonText(lastInput, TEXT_FORMATS[format]));
        return;
    }
    if (lastNoKeysReason) {
        showError(lastNoKeysReason);
        setOutput('');
        return;
    }
    clearError();
    const collapse = collapseEnabled();
    let output;
    switch (format) {
        case 'typed':
            output = formatTypedPaths(lastNodes, collapse);
            break;
        case 'unique':
            output = formatUniqueKeys(lastNodes);
            break;
        case 'jsonpath':
            output = formatJsonPaths(lastNodes, collapse);
            break;
        case 'tree':
            output = formatTree(lastNodes);
            break;
        case 'typescript':
            output = formatTypeScript(lastRoot);
            break;
        default:
            output = formatPaths(lastNodes, collapse);
    }
    setOutput(output);
}

function setOutput(output) {
    document.getElementById('keysOutput').value = output;
    updateLineCount(output);
}

function updateLineCount(output) {
    const el = document.getElementById('outputCount');
    if (!el) {
        return;
    }
    const lines = output ? output.split('\n').length : 0;
    el.textContent = lines + (lines === 1 ? ' line' : ' lines');
}

function renderStats(stats, nodeCount, nodes, byteLength) {
    const panel = document.getElementById('statsPanel');
    if (!panel) {
        return;
    }
    const uniqueKeys = new Set(nodes.map(n => n.key)).size;
    const cells = [
        { label: 'Key paths', value: nodeCount },
        { label: 'Unique key names', value: uniqueKeys },
        { label: 'Max depth', value: stats.maxDepth },
        { label: 'Objects', value: stats.objects },
        { label: 'Arrays', value: stats.arrays },
        { label: 'Size', value: formatBytes(byteLength) }
    ];
    panel.innerHTML = cells.map(c =>
        '<div class="stat-cell"><span class="stat-value">' + c.value +
        '</span><span class="stat-label">' + c.label + '</span></div>'
    ).join('');
    panel.classList.add('show');
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ---------------------------------------------------------------------------
   Parse errors
   Browsers vary in how much detail they give. Newer engines already report a
   line and column; older ones only give a character offset, which we convert.
--------------------------------------------------------------------------- */

const PARSE_HINT = ' Look for a trailing comma, a missing quote, or an unclosed bracket.';

function describeParseError(error, input) {
    const message = error.message || 'Invalid JSON';

    // Newer engines already report line and column - use their message as-is.
    if (/line \d+/i.test(message)) {
        return message;
    }

    // Older engines give only a character offset, which we turn into line/column.
    const match = /position (\d+)/.exec(message);
    if (match) {
        const position = Number(match[1]);
        const before = input.slice(0, position);
        const line = before.split('\n').length;
        const column = position - before.lastIndexOf('\n');
        const summary = message.split(' in JSON at position')[0];
        return summary + ' (line ' + line + ', column ' + column + ')';
    }

    // Some engines give neither, and append a long echo of the source instead.
    // A trailing comma is the most common cause and the easiest to pinpoint, so
    // look for one before falling back to the engine's own complaint.
    const trailing = findTrailingComma(input);
    if (trailing) {
        return 'Trailing comma before "' + trailing.close + '" (line ' + trailing.line +
            ', column ' + trailing.column + '). JSON does not allow a comma after the last item.';
    }
    // Strip the echo, which may be truncated with "..." at either end, so the
    // user sees the actual complaint.
    const trimmed = message.replace(/,?\s*(\.\.\.)?"[\s\S]*"\s*is not valid JSON\s*$/, '')
        .replace(/,?\s*(\.\.\.)?"[\s\S]*\.\.\."\s*is not valid JSON\s*$/, '');
    return (trimmed || message).replace(/[.\s]*$/, '.') + PARSE_HINT;
}

// The position of the first comma followed only by whitespace and a closing
// bracket, ignoring anything inside strings, or null if there is none.
function findTrailingComma(input) {
    let inString = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (inString) {
            if (ch === '\\') {
                i++;
            } else if (ch === '"') {
                inString = false;
            }
        } else if (ch === '"') {
            inString = true;
        } else if (ch === ',') {
            let j = i + 1;
            while (j < input.length && ' \t\n\r'.includes(input[j])) {
                j++;
            }
            if (input[j] === ']' || input[j] === '}') {
                const before = input.slice(0, i);
                return {
                    close: input[j],
                    line: before.split('\n').length,
                    column: i - before.lastIndexOf('\n')
                };
            }
        }
    }
    return null;
}

function showError(message) {
    const box = document.getElementById('errorBox');
    if (box) {
        box.textContent = message;
        box.classList.add('show');
    }
    showToast(message);
}

function clearError() {
    const box = document.getElementById('errorBox');
    if (box) {
        box.textContent = '';
        box.classList.remove('show');
    }
}

/* ---------------------------------------------------------------------------
   Actions
--------------------------------------------------------------------------- */

function handleSubmit() {
    const input = document.getElementById('textbox1').value;
    clearError();

    if (!input.trim()) {
        showError('Paste some JSON into the input box first.');
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(input);
    } catch (e) {
        showError('Invalid JSON: ' + describeParseError(e, input));
        return;
    }

    const type = getType(parsed);
    const result = analyze(parsed);
    if (type !== 'object' && type !== 'array') {
        lastNoKeysReason = 'That is valid JSON, but it is a single ' + type +
            ' value with no keys to extract. The formatted and minified formats still work.';
    } else if (!result.nodes.length) {
        lastNoKeysReason = 'Parsed successfully, but this JSON contains no keys.' +
            ' The formatted and minified formats still work.';
    } else {
        lastNoKeysReason = null;
    }

    lastNodes = result.nodes;
    lastRoot = parsed;
    lastInput = input;
    render();
    renderStats(result.stats, result.nodes.length, result.nodes, new Blob([input]).size);
}

function handleClear() {
    document.getElementById('textbox1').value = '';
    document.getElementById('keysOutput').value = '';
    lastNodes = null;
    lastRoot = null;
    lastInput = '';
    lastNoKeysReason = null;
    clearError();
    updateLineCount('');
    const panel = document.getElementById('statsPanel');
    if (panel) {
        panel.classList.remove('show');
        panel.innerHTML = '';
    }
    if (typeof resetCurlPanel === 'function') {
        resetCurlPanel();
    }
}

function handleCopy() {
    const keysOutput = document.getElementById('keysOutput');
    if (!keysOutput.value) {
        showToast('Nothing to copy yet.');
        return;
    }
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(keysOutput.value)
            .then(() => showToast('Copied to clipboard.'))
            .catch(() => showToast('Failed to copy.'));
    } else {
        keysOutput.select();
        keysOutput.setSelectionRange(0, keysOutput.value.length);
        try {
            showToast(document.execCommand('copy') ? 'Copied to clipboard.' : 'Failed to copy.');
        } catch (err) {
            showToast('Failed to copy.');
        }
    }
}

function handleDownload() {
    const output = document.getElementById('keysOutput').value;
    if (!output) {
        showToast('Nothing to download yet.');
        return;
    }
    const format = currentFormat();
    const extension = format === 'typescript' ? 'ts' : isTextFormat(format) ? 'json' : 'txt';
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const name = isTextFormat(format) ? 'formatted.' + extension : 'json-keys.' + extension;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Downloaded ' + name);
}

const SAMPLE_JSON = {
    "requestId": "req_8fa21c",
    "user": {
        "id": 4417,
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "verified": true,
        "address": {
            "street": "12 Analytical Way",
            "city": "London",
            "postcode": "EC1A 1BB",
            "country": { "code": "GB", "name": "United Kingdom" }
        },
        "roles": ["admin", "engineer"]
    },
    "orders": [
        {
            "orderId": "ord_1001",
            "total": 249.99,
            "currency": "GBP",
            "items": [
                { "sku": "KB-01", "qty": 1, "price": 199.99 },
                { "sku": "MS-07", "qty": 2, "price": 25.00 }
            ],
            "shipping": { "method": "express", "trackingCode": "TRK99213" }
        },
        {
            "orderId": "ord_1002",
            "total": 15.50,
            "currency": "GBP",
            "items": [{ "sku": "CB-22", "qty": 1, "price": 15.50 }],
            "shipping": { "method": "standard", "trackingCode": null },
            "giftMessage": "Happy birthday"
        }
    ],
    "pagination": { "page": 1, "perPage": 20, "total": 2, "hasMore": false },
    "meta": { "generatedAt": "2026-08-05T09:30:00Z", "version": "2.1" }
};

// Tool pages embed their own example as <script type="application/json"
// id="pageSample">, so each page demonstrates the payload its text discusses.
// It is loaded verbatim: a parse/stringify round trip would round large
// integers and drop trailing zeros, which the formatter page is about.
function loadSample() {
    const own = document.getElementById('pageSample');
    document.getElementById('textbox1').value = own
        ? own.textContent.trim()
        : JSON.stringify(SAMPLE_JSON, null, 2);
    handleSubmit();
}

function readFile(file) {
    if (!file) {
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showError('That file is larger than 5 MB. Paste a smaller sample instead.');
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        document.getElementById('textbox1').value = e.target.result;
        handleSubmit();
    };
    reader.onerror = function () {
        showError('Could not read that file.');
    };
    reader.readAsText(file);
}

function handleFileInput(event) {
    readFile(event.target.files[0]);
    event.target.value = '';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const body = document.getElementById('toast-body');
    if (!toast || !body) {
        return;
    }
    body.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

document.addEventListener('DOMContentLoaded', function () {
    const format = document.getElementById('outputFormat');
    const collapse = document.getElementById('collapseArrays');
    if (format) {
        applyFormatFromUrl(format);
        syncControls();
        format.addEventListener('change', syncControls);
        format.addEventListener('change', render);
    }
    if (collapse) {
        collapse.addEventListener('change', render);
    }

    const input = document.getElementById('textbox1');
    if (input) {
        ['dragenter', 'dragover'].forEach(name => {
            input.addEventListener(name, function (e) {
                e.preventDefault();
                input.classList.add('drag-active');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            input.addEventListener(name, function (e) {
                e.preventDefault();
                input.classList.remove('drag-active');
            });
        });
        input.addEventListener('drop', function (e) {
            const file = e.dataTransfer && e.dataTransfer.files[0];
            if (file) {
                readFile(file);
            }
        });
        // Ctrl/Cmd + Enter extracts without reaching for the mouse.
        input.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
            }
        });
    }
});
