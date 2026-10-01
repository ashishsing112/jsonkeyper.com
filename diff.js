/* JSON Keyper - JSON Diff.
   Compares two JSON documents by value and by structure, entirely in the
   browser. Numbers are compared by their literal text, so values that
   JSON.parse would round (integers above 2^53) or normalise (12.50) are
   compared exactly as written. */

/* ---------------------------------------------------------------------------
   Parsing
   A small parser that keeps what JSON.parse throws away: the literal text of
   every number, and duplicate keys. Callers must validate the text with
   JSON.parse first (for its error messages); this parser assumes valid JSON.

   Nodes: { t: 'object', keys: Map<key, node>, dupes: [key] }
          { t: 'array', items: [node] }
          { t: 'string', v }   { t: 'number', raw }
          { t: 'boolean', v }  { t: 'null' }
--------------------------------------------------------------------------- */

function parsePreserving(text) {
    let i = 0;

    function ws() {
        while (i < text.length && ' \t\n\r'.includes(text[i])) {
            i++;
        }
    }

    function str() {
        const start = i;
        i++;
        while (text[i] !== '"') {
            i += text[i] === '\\' ? 2 : 1;
        }
        i++;
        return JSON.parse(text.slice(start, i));
    }

    function value() {
        ws();
        const ch = text[i];
        if (ch === '{') {
            i++;
            const keys = new Map();
            const dupes = [];
            ws();
            if (text[i] === '}') {
                i++;
                return { t: 'object', keys: keys, dupes: dupes };
            }
            for (;;) {
                ws();
                const key = str();
                ws();
                i++; // :
                const v = value();
                if (keys.has(key)) {
                    dupes.push(key);
                    keys.delete(key); // last one wins, and moves to its final position
                }
                keys.set(key, v);
                ws();
                if (text[i++] === '}') {
                    return { t: 'object', keys: keys, dupes: dupes };
                }
            }
        }
        if (ch === '[') {
            i++;
            const items = [];
            ws();
            if (text[i] === ']') {
                i++;
                return { t: 'array', items: items };
            }
            for (;;) {
                items.push(value());
                ws();
                if (text[i++] === ']') {
                    return { t: 'array', items: items };
                }
            }
        }
        if (ch === '"') {
            return { t: 'string', v: str() };
        }
        if (text.startsWith('true', i)) {
            i += 4;
            return { t: 'boolean', v: true };
        }
        if (text.startsWith('false', i)) {
            i += 5;
            return { t: 'boolean', v: false };
        }
        if (text.startsWith('null', i)) {
            i += 4;
            return { t: 'null' };
        }
        const start = i;
        while (i < text.length && !',]} \t\n\r'.includes(text[i])) {
            i++;
        }
        return { t: 'number', raw: text.slice(start, i) };
    }

    return value();
}

// Serialise a node back to compact JSON, numbers exactly as written.
function nodeToJson(node) {
    switch (node.t) {
        case 'object':
            return '{' + Array.from(node.keys, ([k, v]) => JSON.stringify(k) + ':' + nodeToJson(v)).join(',') + '}';
        case 'array':
            return '[' + node.items.map(nodeToJson).join(',') + ']';
        case 'string':
            return JSON.stringify(node.v);
        case 'number':
            return node.raw;
        case 'boolean':
            return String(node.v);
        default:
            return 'null';
    }
}

// Every duplicate key in a document, as display paths.
function findDuplicateKeys(node, path, out) {
    out = out || [];
    path = path || [];
    if (node.t === 'object') {
        for (const key of node.dupes) {
            out.push(formatPath(path.concat([{ key: key }])));
        }
        for (const [key, child] of node.keys) {
            findDuplicateKeys(child, path.concat([{ key: key }]), out);
        }
    } else if (node.t === 'array') {
        node.items.forEach((child, index) => findDuplicateKeys(child, path.concat([{ index: index }]), out));
    }
    return out;
}

/* ---------------------------------------------------------------------------
   Paths
   A path is a list of segments: { key } for an object member, { index } for
   an array element, and { index, match } for an array element that was
   paired with its counterpart by a key field, e.g. orders[id="ord_1"].
--------------------------------------------------------------------------- */

function isIdentifier(key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function formatPath(path) {
    let out = '';
    for (const seg of path) {
        if (seg.match) {
            out += '[' + seg.match.field + '=' + seg.match.label + ']';
        } else if ('index' in seg) {
            out += '[' + seg.index + ']';
        } else if (isIdentifier(seg.key)) {
            out += (out ? '.' : '') + seg.key;
        } else {
            out += '[' + JSON.stringify(seg.key) + ']';
        }
    }
    return out || '(root)';
}

// RFC 6901 JSON Pointer. Array elements are always addressed by position.
function toPointer(path) {
    return path.map(seg => '/' + ('index' in seg ? String(seg.index) : seg.key.replace(/~/g, '~0').replace(/\//g, '~1'))).join('');
}

/* ---------------------------------------------------------------------------
   Value comparison
--------------------------------------------------------------------------- */

// Canonical form of a number literal, for "12.50 equals 12.5" comparisons.
// Exact decimal arithmetic on the digits, so large integers never collide.
function canonicalNumber(raw) {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
    if (!m) {
        return raw;
    }
    let digits = (m[2] + (m[3] || '')).replace(/^0+/, '');
    let exp = parseInt(m[4] || '0', 10) - (m[3] || '').length;
    if (!digits) {
        return '0';
    }
    while (digits.endsWith('0')) {
        digits = digits.slice(0, -1);
        exp++;
    }
    return m[1] + digits + 'e' + exp;
}

function scalarKey(node) {
    switch (node.t) {
        case 'string':
            return 's:' + node.v;
        case 'number':
            return 'n:' + canonicalNumber(node.raw);
        case 'boolean':
            return 'b:' + node.v;
        case 'null':
            return 'z';
        default:
            return null;
    }
}

function scalarsEqual(a, b, options) {
    if (a.t !== b.t) {
        return false;
    }
    if (a.t === 'number') {
        return options.numericEquality ? canonicalNumber(a.raw) === canonicalNumber(b.raw) : a.raw === b.raw;
    }
    return a.t === 'null' || a.v === b.v;
}

function nodeType(node) {
    return node.t;
}

/* ---------------------------------------------------------------------------
   Array matching
   Pairing elements by position turns one insertion at the top of a list into
   a change on every element after it. When every object element on both
   sides carries the same identifying field with unique scalar values, the
   elements are paired by that field instead.
--------------------------------------------------------------------------- */

const MATCH_FIELD_CANDIDATES = ['id', '_id', 'uuid', 'guid', 'key', 'code', 'sku', 'slug', 'name'];

function detectMatchField(a, b, requested) {
    const items = a.items.concat(b.items);
    if (!items.length || !items.every(n => n.t === 'object')) {
        return null;
    }
    const candidates = requested ? [requested] : MATCH_FIELD_CANDIDATES;
    for (const field of candidates) {
        const ok = [a, b].every(arr => {
            const seen = new Set();
            for (const item of arr.items) {
                const v = item.keys.get(field);
                const k = v && scalarKey(v);
                if (!k || v.t === 'null' || seen.has(k)) {
                    return false;
                }
                seen.add(k);
            }
            return true;
        });
        if (ok) {
            return field;
        }
    }
    return null;
}

/* ---------------------------------------------------------------------------
   Value diff
   Each change: { kind: 'added' | 'removed' | 'changed', path, before?, after?,
   beforeType?, afterType? }. `before` and `after` are nodes.
--------------------------------------------------------------------------- */

function diffDocuments(a, b, options) {
    options = Object.assign({ arrayMatch: 'auto', matchField: '', numericEquality: false }, options);
    const changes = [];
    const matchedBy = new Set();

    function walk(x, y, path) {
        if (x.t !== y.t) {
            changes.push({ kind: 'changed', path: path, before: x, after: y, beforeType: x.t, afterType: y.t });
            return;
        }
        if (x.t === 'object') {
            for (const [key, xv] of x.keys) {
                const seg = path.concat([{ key: key }]);
                if (y.keys.has(key)) {
                    walk(xv, y.keys.get(key), seg);
                } else {
                    changes.push({ kind: 'removed', path: seg, before: xv });
                }
            }
            for (const [key, yv] of y.keys) {
                if (!x.keys.has(key)) {
                    changes.push({ kind: 'added', path: path.concat([{ key: key }]), after: yv });
                }
            }
            return;
        }
        if (x.t === 'array') {
            const field = options.arrayMatch === 'index' ? null : detectMatchField(x, y, options.matchField);
            if (field) {
                matchedBy.add(field);
                walkKeyed(x, y, path, field);
            } else {
                walkIndexed(x, y, path);
            }
            return;
        }
        if (!scalarsEqual(x, y, options)) {
            changes.push({ kind: 'changed', path: path, before: x, after: y });
        }
    }

    function walkIndexed(x, y, path) {
        const common = Math.min(x.items.length, y.items.length);
        for (let i = 0; i < common; i++) {
            walk(x.items[i], y.items[i], path.concat([{ index: i }]));
        }
        for (let i = common; i < y.items.length; i++) {
            changes.push({ kind: 'added', path: path.concat([{ index: i }]), after: y.items[i] });
        }
        for (let i = common; i < x.items.length; i++) {
            changes.push({ kind: 'removed', path: path.concat([{ index: i }]), before: x.items[i] });
        }
    }

    function walkKeyed(x, y, path, field) {
        const label = node => {
            const v = node.keys.get(field);
            return v.t === 'string' ? JSON.stringify(v.v) : v.t === 'number' ? v.raw : String(v.v);
        };
        const inX = new Map(x.items.map((n, i) => [scalarKey(n.keys.get(field)), i]));
        const inY = new Map(y.items.map((n, i) => [scalarKey(n.keys.get(field)), i]));
        x.items.forEach((n, i) => {
            const k = scalarKey(n.keys.get(field));
            const seg = { index: inY.has(k) ? inY.get(k) : i, match: { field: field, label: label(n) } };
            if (inY.has(k)) {
                walk(n, y.items[inY.get(k)], path.concat([seg]));
            } else {
                changes.push({ kind: 'removed', path: path.concat([{ index: i, match: seg.match }]), before: n });
            }
        });
        y.items.forEach((n, i) => {
            const k = scalarKey(n.keys.get(field));
            if (!inX.has(k)) {
                changes.push({ kind: 'added', path: path.concat([{ index: i, match: { field: field, label: label(n) } }]), after: n });
            }
        });
    }

    walk(a, b, []);
    return { changes: changes, matchedBy: Array.from(matchedBy) };
}

/* ---------------------------------------------------------------------------
   JSON Patch (RFC 6902)
   Always generated positionally, never from keyed matching, because a patch
   addresses array elements by index. Applying it to the original produces
   the modified document exactly.
--------------------------------------------------------------------------- */

function toJsonPatch(a, b, options) {
    options = Object.assign({ numericEquality: false }, options);
    const ops = [];

    function walk(x, y, path) {
        if (x.t !== y.t) {
            ops.push({ op: 'replace', path: toPointer(path), value: y });
            return;
        }
        if (x.t === 'object') {
            for (const key of x.keys.keys()) {
                if (!y.keys.has(key)) {
                    ops.push({ op: 'remove', path: toPointer(path.concat([{ key: key }])) });
                }
            }
            for (const [key, yv] of y.keys) {
                const seg = path.concat([{ key: key }]);
                if (x.keys.has(key)) {
                    walk(x.keys.get(key), yv, seg);
                } else {
                    ops.push({ op: 'add', path: toPointer(seg), value: yv });
                }
            }
            return;
        }
        if (x.t === 'array') {
            const common = Math.min(x.items.length, y.items.length);
            for (let i = 0; i < common; i++) {
                walk(x.items[i], y.items[i], path.concat([{ index: i }]));
            }
            for (let i = common; i < y.items.length; i++) {
                ops.push({ op: 'add', path: toPointer(path.concat([{ index: i }])), value: y.items[i] });
            }
            // Remove from the end so earlier indices stay valid.
            for (let i = x.items.length - 1; i >= common; i--) {
                ops.push({ op: 'remove', path: toPointer(path.concat([{ index: i }])) });
            }
            return;
        }
        if (!scalarsEqual(x, y, options)) {
            ops.push({ op: 'replace', path: toPointer(path), value: y });
        }
    }

    walk(a, b, []);
    return ops;
}

function formatJsonPatch(ops) {
    if (!ops.length) {
        return '[]';
    }
    const lines = ops.map(o => {
        const value = 'value' in o ? ', "value": ' + nodeToJson(o.value) : '';
        return '  { "op": "' + o.op + '", "path": ' + JSON.stringify(o.path) + value + ' }';
    });
    return '[\n' + lines.join(',\n') + '\n]';
}

/* ---------------------------------------------------------------------------
   Structure diff
   Reduces each document to its shape - every field path with array indices
   collapsed, the types seen there, and whether it is missing from some array
   elements - then compares the shapes. Changes that can break a consumer of
   the data are marked breaking.
--------------------------------------------------------------------------- */

function collectShape(node) {
    const shape = new Map(); // collapsed path -> { types: Set, optional: bool, path: [] }

    function entry(path) {
        const id = formatPath(path);
        if (!shape.has(id)) {
            shape.set(id, { types: new Set(), optional: false, path: path });
        }
        return shape.get(id);
    }

    // `nodes` are all the values seen at one collapsed path.
    function visit(nodes, path) {
        const objects = [];
        const arrays = [];
        for (const n of nodes) {
            if (path.length) {
                entry(path).types.add(n.t);
            }
            if (n.t === 'object') {
                objects.push(n);
            } else if (n.t === 'array') {
                arrays.push(n);
            }
        }
        if (objects.length) {
            const byKey = new Map();
            for (const o of objects) {
                for (const [key, v] of o.keys) {
                    if (!byKey.has(key)) {
                        byKey.set(key, []);
                    }
                    byKey.get(key).push(v);
                }
            }
            for (const [key, values] of byKey) {
                const childPath = path.concat([{ key: key }]);
                visit(values, childPath);
                if (values.length < objects.length) {
                    entry(childPath).optional = true;
                }
            }
        }
        if (arrays.length) {
            const items = [].concat(...arrays.map(a => a.items));
            if (items.length) {
                visit(items, path.concat([{ index: '' }]));
            }
        }
    }

    visit([node], []);
    return shape;
}

function describeTypes(types) {
    const list = Array.from(types).filter(t => t !== 'null').sort();
    return list.length ? list.join(' | ') : 'null';
}

function diffStructure(a, b) {
    const before = collectShape(a);
    const after = collectShape(b);
    const changes = [];
    const covered = []; // ids whose descendants are implied by an add/remove

    const isUnder = id => covered.some(c => id.startsWith(c + '.') || id.startsWith(c + '['));

    for (const [id, s] of before) {
        if (!after.has(id) && !isUnder(id)) {
            changes.push({ id: id, change: 'Field removed', detail: describeTypes(s.types), breaking: true });
            covered.push(id);
        }
    }
    for (const [id, s] of after) {
        if (!before.has(id) && !isUnder(id)) {
            changes.push({ id: id, change: 'Field added', detail: describeTypes(s.types) + (s.optional ? ', optional' : ''), breaking: false });
            covered.push(id);
        }
    }
    for (const [id, s] of before) {
        const t = after.get(id);
        if (!t) {
            continue;
        }
        const was = describeTypes(s.types);
        const now = describeTypes(t.types);
        if (was !== now && was !== 'null' && now !== 'null') {
            changes.push({ id: id, change: 'Type changed', detail: was + ' → ' + now, breaking: true });
        }
        // "string | null", or just "null" when null is the only type seen.
        const withNull = types => (types === 'null' ? 'null' : types + ' | null');
        if (!s.types.has('null') && t.types.has('null')) {
            changes.push({ id: id, change: 'Became nullable', detail: was + ' → ' + withNull(now), breaking: true });
        } else if (s.types.has('null') && !t.types.has('null')) {
            changes.push({ id: id, change: 'No longer null', detail: withNull(was) + ' → ' + now, breaking: false });
        }
        if (!s.optional && t.optional) {
            changes.push({ id: id, change: 'Became optional', detail: 'missing from some elements', breaking: true });
        } else if (s.optional && !t.optional) {
            changes.push({ id: id, change: 'Now always present', detail: 'was missing from some elements', breaking: false });
        }
    }
    changes.sort((x, y) => (y.breaking - x.breaking) || x.id.localeCompare(y.id));
    return changes;
}

/* ---------------------------------------------------------------------------
   Reports
--------------------------------------------------------------------------- */

function previewValue(node, max) {
    const text = nodeToJson(node);
    max = max || 80;
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function changesToMarkdown(result, structure) {
    const lines = ['# JSON diff', ''];
    const counts = countChanges(result.changes);
    lines.push(counts.added + ' added, ' + counts.removed + ' removed, ' + counts.changed + ' changed.', '');
    if (structure.length) {
        lines.push('## Structure', '', '| Field | Change | Detail |', '| --- | --- | --- |');
        for (const s of structure) {
            lines.push('| `' + s.id + '` | ' + s.change + (s.breaking ? ' (breaking)' : '') + ' | ' + s.detail.replace(/\|/g, '\\|') + ' |');
        }
        lines.push('');
    }
    if (result.changes.length) {
        lines.push('## Values', '');
        for (const c of result.changes) {
            const p = '`' + formatPath(c.path) + '`';
            if (c.kind === 'added') {
                lines.push('- **added** ' + p + ': `' + previewValue(c.after) + '`');
            } else if (c.kind === 'removed') {
                lines.push('- **removed** ' + p + ': `' + previewValue(c.before) + '`');
            } else {
                lines.push('- **changed** ' + p + ': `' + previewValue(c.before) + '` → `' + previewValue(c.after) + '`');
            }
        }
    }
    return lines.join('\n') + '\n';
}

function countChanges(changes) {
    const counts = { added: 0, removed: 0, changed: 0 };
    for (const c of changes) {
        counts[c.kind]++;
    }
    return counts;
}

/* ---------------------------------------------------------------------------
   Page wiring (browser only)
   Relies on script.js for describeParseError and showToast.
--------------------------------------------------------------------------- */

const diffState = { result: null, structure: null, patch: null, view: 'changes', a: null, b: null };

function escapeHtml(text) {
    return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function diffInput(id) {
    return document.getElementById(id);
}

function parseSide(id, label) {
    const text = diffInput(id).value;
    const box = document.getElementById(id + 'Error');
    box.textContent = '';
    box.classList.remove('show');
    const fail = message => {
        box.textContent = label + ': ' + message;
        box.classList.add('show');
        return null;
    };
    if (!text.trim()) {
        return fail('paste some JSON first.');
    }
    try {
        JSON.parse(text);
    } catch (e) {
        return fail('invalid JSON. ' + describeParseError(e, text));
    }
    return parsePreserving(text);
}

function runDiff() {
    const a = parseSide('diffOriginal', 'Original');
    const b = parseSide('diffModified', 'Modified');
    if (!a || !b) {
        showToast('Fix the JSON errors above, then compare again.');
        return;
    }
    const options = {
        arrayMatch: document.getElementById('diffArrayMatch').value,
        numericEquality: document.getElementById('diffNumericEquality').checked
    };
    diffState.a = a;
    diffState.b = b;
    diffState.result = diffDocuments(a, b, options);
    diffState.structure = diffStructure(a, b);
    diffState.patch = toJsonPatch(a, b, options);
    renderSummary(options);
    document.getElementById('diffResults').hidden = false;
    renderDiff();
    if (typeof gtag === 'function') {
        gtag('event', 'json_diff_run');
    }
}

function renderSummary(options) {
    const counts = countChanges(diffState.result.changes);
    const breaking = diffState.structure.filter(s => s.breaking).length;
    const chip = (cls, n, label) => '<span class="diff-chip ' + cls + '"><strong>' + n + '</strong> ' + label + '</span>';
    let html = chip('chip-added', counts.added, 'added') + chip('chip-removed', counts.removed, 'removed') +
        chip('chip-changed', counts.changed, 'changed') + chip('chip-breaking', breaking, breaking === 1 ? 'breaking change' : 'breaking changes');
    const matched = diffState.result.matchedBy;
    if (options.arrayMatch !== 'index') {
        html += '<span class="diff-summary-note">' + (matched.length
            ? 'Array items matched by <code>' + matched.map(escapeHtml).join('</code>, <code>') + '</code>'
            : 'Array items compared by position (no shared ID field found)') + '</span>';
    }
    document.getElementById('diffSummary').innerHTML = html;

    const dupes = findDuplicateKeys(diffState.a).map(p => 'Original ' + p).concat(findDuplicateKeys(diffState.b).map(p => 'Modified ' + p));
    const notice = document.getElementById('diffNotice');
    notice.hidden = !dupes.length;
    notice.textContent = dupes.length ? 'Duplicate keys - the last value is used: ' + dupes.slice(0, 5).join(', ') + (dupes.length > 5 ? ', ...' : '') : '';
}

function setDiffView(view) {
    diffState.view = view;
    document.querySelectorAll('.diff-views .mode-tab').forEach(tab => {
        const active = tab.dataset.view === view;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderDiff();
}

const DIFF_RENDER_LIMIT = 1000;

function renderDiff() {
    if (!diffState.result) {
        return;
    }
    const view = document.getElementById('diffView');
    document.getElementById('diffFilters').hidden = diffState.view !== 'changes';
    if (diffState.view === 'patch') {
        view.innerHTML = '<pre class="diff-patch">' + escapeHtml(formatJsonPatch(diffState.patch)) + '</pre>';
        return;
    }
    if (diffState.view === 'structure') {
        if (!diffState.structure.length) {
            view.innerHTML = '<p class="diff-empty">No structural changes - the same fields, types, and nullability on both sides.</p>';
            return;
        }
        view.innerHTML = '<div class="table-wrap"><table class="reference-table diff-structure"><thead><tr><th>Field</th><th>Change</th><th>Detail</th></tr></thead><tbody>' +
            diffState.structure.map(s => '<tr><td><code>' + escapeHtml(s.id) + '</code></td><td>' + escapeHtml(s.change) +
                (s.breaking ? ' <span class="diff-badge">Breaking</span>' : '') + '</td><td>' + escapeHtml(s.detail) + '</td></tr>').join('') +
            '</tbody></table></div>';
        return;
    }
    const show = {};
    document.querySelectorAll('#diffFilters input').forEach(box => { show[box.dataset.kind] = box.checked; });
    const changes = diffState.result.changes.filter(c => show[c.kind]);
    if (!diffState.result.changes.length) {
        view.innerHTML = '<p class="diff-empty">No differences. The two documents contain the same data.</p>';
        return;
    }
    const sign = { added: '+', removed: '−', changed: '~' };
    const rows = changes.slice(0, DIFF_RENDER_LIMIT).map(c => {
        let value;
        if (c.kind === 'added') {
            value = '<span class="diff-after">' + escapeHtml(previewValue(c.after, 160)) + '</span>';
        } else if (c.kind === 'removed') {
            value = '<span class="diff-before">' + escapeHtml(previewValue(c.before, 160)) + '</span>';
        } else {
            value = '<span class="diff-before">' + escapeHtml(previewValue(c.before, 80)) + '</span> <span class="diff-arrow">→</span> <span class="diff-after">' +
                escapeHtml(previewValue(c.after, 80)) + '</span>' + (c.beforeType ? ' <span class="diff-type">' + c.beforeType + ' → ' + c.afterType + '</span>' : '');
        }
        return '<li class="diff-item diff-' + c.kind + '"><span class="diff-sign" aria-label="' + c.kind + '">' + sign[c.kind] + '</span>' +
            '<code class="diff-path">' + escapeHtml(formatPath(c.path)) + '</code><span class="diff-value">' + value + '</span></li>';
    });
    const more = changes.length > DIFF_RENDER_LIMIT
        ? '<p class="diff-empty">Showing the first ' + DIFF_RENDER_LIMIT + ' of ' + changes.length + ' changes. Copy or download for the full list.</p>' : '';
    view.innerHTML = rows.length ? '<ol class="diff-list">' + rows.join('') + '</ol>' + more : '<p class="diff-empty">No changes of the selected kinds.</p>';
}

function diffText() {
    if (diffState.view === 'patch') {
        return formatJsonPatch(diffState.patch) + '\n';
    }
    if (diffState.view === 'structure') {
        return changesToMarkdown({ changes: [] }, diffState.structure).replace('0 added, 0 removed, 0 changed.\n\n', '');
    }
    return changesToMarkdown(diffState.result, diffState.structure);
}

function copyDiff() {
    if (!diffState.result) {
        return;
    }
    navigator.clipboard.writeText(diffText())
        .then(() => showToast('Copied to clipboard.'))
        .catch(() => showToast('Failed to copy.'));
}

function downloadDiff() {
    if (!diffState.result) {
        return;
    }
    const name = diffState.view === 'patch' ? 'json-patch.json' : 'json-diff.md';
    const url = URL.createObjectURL(new Blob([diffText()], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Downloaded ' + name);
}

function loadDiffExample() {
    const example = JSON.parse(document.getElementById('diffExample').textContent);
    diffInput('diffOriginal').value = JSON.stringify(example.original, null, 2);
    diffInput('diffModified').value = JSON.stringify(example.modified, null, 2);
    runDiff();
}

function clearDiffSide(id) {
    diffInput(id).value = '';
    const box = document.getElementById(id + 'Error');
    box.textContent = '';
    box.classList.remove('show');
    diffState.result = null;
    document.getElementById('diffResults').hidden = true;
}

function swapDiffSides() {
    const a = diffInput('diffOriginal');
    const b = diffInput('diffModified');
    [a.value, b.value] = [b.value, a.value];
    if (diffState.result && a.value.trim() && b.value.trim()) {
        runDiff();
    }
}

function readDiffFile(file, id) {
    if (!file) {
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('That file is larger than 5 MB.');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        diffInput(id).value = e.target.result;
    };
    reader.readAsText(file);
}

function handleDiffFile(event, id) {
    readDiffFile(event.target.files[0], id);
    event.target.value = '';
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
        ['diffOriginal', 'diffModified'].forEach(id => {
            const input = diffInput(id);
            if (!input) {
                return;
            }
            input.addEventListener('keydown', e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    runDiff();
                }
            });
            ['dragenter', 'dragover'].forEach(name => input.addEventListener(name, e => {
                e.preventDefault();
                input.classList.add('drag-active');
            }));
            ['dragleave', 'drop'].forEach(name => input.addEventListener(name, e => {
                e.preventDefault();
                input.classList.remove('drag-active');
            }));
            input.addEventListener('drop', e => readDiffFile(e.dataTransfer && e.dataTransfer.files[0], id));
        });
        ['diffArrayMatch', 'diffNumericEquality'].forEach(id => {
            const control = document.getElementById(id);
            if (control) {
                control.addEventListener('change', () => {
                    if (diffState.result) {
                        runDiff();
                    }
                });
            }
        });
    });
}

if (typeof module !== 'undefined') {
    module.exports = {
        parsePreserving, nodeToJson, findDuplicateKeys, formatPath, toPointer, canonicalNumber,
        detectMatchField, diffDocuments, toJsonPatch, formatJsonPatch, collectShape, diffStructure,
        changesToMarkdown, countChanges, previewValue
    };
}
