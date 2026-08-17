/* JSON Keyper - key extraction, path formatting and structure analysis.
   Everything runs in the browser; no JSON is ever sent to a server. */

var lastNodes = null;
var lastRoot = null;

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

/* TypeScript interface generation. Objects inside an array are merged so that
   a key missing from some elements is emitted as optional. */

function mergeArrayObjects(items) {
    const shape = {};
    const counts = {};
    for (const item of items) {
        for (const key of Object.keys(item)) {
            counts[key] = (counts[key] || 0) + 1;
            if (!(key in shape) || shape[key] === null || shape[key] === undefined) {
                shape[key] = item[key];
            }
        }
    }
    const optional = new Set(Object.keys(counts).filter(k => counts[k] < items.length));
    return { shape: shape, optional: optional };
}

function tsKeyName(key) {
    return isBareKey(key) ? key : JSON.stringify(key);
}

function tsObjectBody(shape, optional, indent) {
    const keys = Object.keys(shape);
    if (!keys.length) {
        return 'Record<string, never>';
    }
    const pad = '  '.repeat(indent + 1);
    const closePad = '  '.repeat(indent);
    const lines = keys.map(key => {
        const mark = optional.has(key) ? '?' : '';
        return pad + tsKeyName(key) + mark + ': ' + tsType(shape[key], indent + 1) + ';';
    });
    return '{\n' + lines.join('\n') + '\n' + closePad + '}';
}

function tsType(value, indent) {
    const type = getType(value);
    if (type === 'string' || type === 'number' || type === 'boolean') {
        return type;
    }
    if (type === 'null') {
        return 'null';
    }
    if (type === 'array') {
        if (!value.length) {
            return 'unknown[]';
        }
        if (value.every(item => getType(item) === 'object')) {
            const merged = mergeArrayObjects(value);
            return tsObjectBody(merged.shape, merged.optional, indent) + '[]';
        }
        const inner = dedupe(value.map(item => tsType(item, indent)));
        return (inner.length === 1 ? inner[0] : '(' + inner.join(' | ') + ')') + '[]';
    }
    if (type === 'object') {
        return tsObjectBody(value, new Set(), indent);
    }
    return 'unknown';
}

function formatTypeScript(root) {
    if (getType(root) === 'array') {
        return 'type Root = ' + tsType(root, 0) + ';';
    }
    return 'interface Root ' + tsObjectBody(root, new Set(), 0);
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

function collapseEnabled() {
    const box = document.getElementById('collapseArrays');
    return !!(box && box.checked);
}

function render() {
    if (!lastNodes) {
        return;
    }
    const collapse = collapseEnabled();
    let output;
    switch (currentFormat()) {
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
    // Strip that echo so the user sees the actual complaint.
    const trimmed = message.replace(/,?\s*(\.\.\.)?"[\s\S]*"\s*is not valid JSON\s*$/, '');
    return (trimmed || message) + PARSE_HINT;
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
    if (type !== 'object' && type !== 'array') {
        showError('That is valid JSON, but it is a single ' + type + ' value with no keys to extract.');
        return;
    }

    const result = analyze(parsed);
    if (!result.nodes.length) {
        showError('Parsed successfully, but this JSON contains no keys.');
        document.getElementById('keysOutput').value = '';
        return;
    }

    lastNodes = result.nodes;
    lastRoot = parsed;
    render();
    renderStats(result.stats, result.nodes.length, result.nodes, new Blob([input]).size);
}

function handleClear() {
    document.getElementById('textbox1').value = '';
    document.getElementById('keysOutput').value = '';
    lastNodes = null;
    lastRoot = null;
    clearError();
    updateLineCount('');
    const panel = document.getElementById('statsPanel');
    if (panel) {
        panel.classList.remove('show');
        panel.innerHTML = '';
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
    const extension = currentFormat() === 'typescript' ? 'ts' : 'txt';
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'json-keys.' + extension;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Downloaded json-keys.' + extension);
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

function loadSample() {
    document.getElementById('textbox1').value = JSON.stringify(SAMPLE_JSON, null, 2);
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
