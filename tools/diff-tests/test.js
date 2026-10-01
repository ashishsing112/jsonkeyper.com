/* Tests for diff.js. No dependencies:

       node tools/diff-tests/test.js

   Property tests run on thousands of random document pairs; fixtures pin the
   cases the JSON Diff page makes promises about. */
const assert = require('assert');
const D = require('../../diff.js');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
    } catch (e) {
        console.error('FAIL', name, '\n ', e.message);
        process.exitCode = 1;
    }
}

const parse = text => (JSON.parse(text), D.parsePreserving(text));

// Key-order-independent serialisation, for comparing documents.
function canon(node) {
    if (node.t === 'object') {
        return '{' + Array.from(node.keys.keys()).sort().map(k => JSON.stringify(k) + ':' + canon(node.keys.get(k))).join(',') + '}';
    }
    if (node.t === 'array') {
        return '[' + node.items.map(canon).join(',') + ']';
    }
    return D.nodeToJson(node);
}

// A minimal RFC 6902 applier (add, remove, replace) over parsed nodes.
function applyPatch(doc, ops) {
    const clone = n => D.parsePreserving(D.nodeToJson(n));
    let root = clone(doc);
    for (const op of ops) {
        const parts = op.path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
        if (!parts.length) {
            root = clone(op.value);
            continue;
        }
        let parent = root;
        for (const p of parts.slice(0, -1)) {
            parent = parent.t === 'array' ? parent.items[+p] : parent.keys.get(p);
        }
        const last = parts[parts.length - 1];
        if (parent.t === 'array') {
            const i = +last;
            if (op.op === 'add') parent.items.splice(i, 0, clone(op.value));
            else if (op.op === 'remove') parent.items.splice(i, 1);
            else parent.items[i] = clone(op.value);
        } else if (op.op === 'remove') {
            parent.keys.delete(last);
        } else {
            parent.keys.set(last, clone(op.value));
        }
    }
    return root;
}

/* ---------------------------------------------------------------------------
   Random documents and mutations
--------------------------------------------------------------------------- */
let seed = 1234;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const KEYS = ['id', 'name', 'a', 'b', 'items', 'x/y', 'tilde~', 'meta', 'n', 'weird "q"'];
function randValue(d) {
    const r = rnd();
    if (d > 3 || r < 0.35) return pick([1, -2.5, 0, null, true, false, 'str', 'é\n"', 1e21, 42]);
    if (r < 0.7) {
        const o = {};
        for (let i = 0; i < rnd() * 4; i++) o[pick(KEYS)] = randValue(d + 1);
        return o;
    }
    const a = [];
    for (let i = 0; i < rnd() * 4; i++) a.push(randValue(d + 1));
    return a;
}
function mutate(v, d) {
    if (rnd() < 0.15) return randValue(d + 1);
    if (Array.isArray(v)) {
        const out = v.map(x => (rnd() < 0.3 ? mutate(x, d + 1) : x));
        if (rnd() < 0.3) out.splice(Math.floor(rnd() * (out.length + 1)), 0, randValue(d + 1));
        // Remove up to three elements, so patches must remove several from one array.
        for (let k = Math.floor(rnd() * 4); k > 0 && out.length; k--) out.splice(Math.floor(rnd() * out.length), 1);
        return out;
    }
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) if (rnd() > 0.15) out[k] = rnd() < 0.3 ? mutate(v[k], d + 1) : v[k];
        if (rnd() < 0.3) out[pick(KEYS)] = randValue(d + 1);
        return out;
    }
    return v;
}

/* ---------------------------------------------------------------------------
   Properties
--------------------------------------------------------------------------- */
test('parser round-trips 3,000 random documents', () => {
    for (let n = 0; n < 3000; n++) {
        const text = JSON.stringify(randValue(0), null, rnd() < 0.5 ? 2 : 0);
        assert.strictEqual(D.nodeToJson(parse(text)), JSON.stringify(JSON.parse(text)), text);
    }
});

test('a document diffed with itself has no changes, in every mode', () => {
    for (let n = 0; n < 2000; n++) {
        const a = parse(JSON.stringify(randValue(0)));
        for (const arrayMatch of ['auto', 'index']) {
            assert.strictEqual(D.diffDocuments(a, a, { arrayMatch }).changes.length, 0);
        }
        assert.strictEqual(D.toJsonPatch(a, a).length, 0);
        assert.strictEqual(D.diffStructure(a, a).length, 0);
    }
});

test('applying the JSON Patch to the original yields the modified document (5,000 pairs)', () => {
    for (let n = 0; n < 5000; n++) {
        const v = randValue(0);
        const a = parse(JSON.stringify(v));
        const b = parse(JSON.stringify(mutate(v, 0)));
        const patched = applyPatch(a, D.toJsonPatch(a, b));
        assert.strictEqual(canon(patched), canon(b), JSON.stringify(D.toJsonPatch(a, b)));
    }
});

test('swapping the inputs mirrors every change (5,000 pairs)', () => {
    for (let n = 0; n < 5000; n++) {
        const v = randValue(0);
        const a = parse(JSON.stringify(v));
        const b = parse(JSON.stringify(mutate(v, 0)));
        for (const arrayMatch of ['auto', 'index']) {
            const fwd = D.countChanges(D.diffDocuments(a, b, { arrayMatch }).changes);
            const back = D.countChanges(D.diffDocuments(b, a, { arrayMatch }).changes);
            assert.deepStrictEqual([fwd.added, fwd.removed, fwd.changed], [back.removed, back.added, back.changed]);
        }
    }
});

/* ---------------------------------------------------------------------------
   Fixtures: the promises the page makes
--------------------------------------------------------------------------- */
const diff = (x, y, o) => D.diffDocuments(parse(x), parse(y), o).changes.map(c => c.kind + ' ' + D.formatPath(c.path));

test('large integers are compared exactly', () => {
    assert.deepStrictEqual(diff('{"id":1839274619283746817}', '{"id":1839274619283746818}'), ['changed id']);
});

test('12.50 vs 12.5 is a change by default, equal with numericEquality', () => {
    assert.deepStrictEqual(diff('{"a":12.50}', '{"a":12.5}'), ['changed a']);
    assert.deepStrictEqual(diff('{"a":12.50,"b":1e2,"c":0.0}', '{"a":12.5,"b":100,"c":0}', { numericEquality: true }), []);
    assert.deepStrictEqual(diff('{"id":1839274619283746817}', '{"id":1839274619283746818}', { numericEquality: true }), ['changed id']);
});

test('key order is ignored', () => {
    assert.deepStrictEqual(diff('{"a":1,"b":{"c":2,"d":3}}', '{"b":{"d":3,"c":2},"a":1}'), []);
});

test('null and a missing key are different', () => {
    assert.deepStrictEqual(diff('{"a":null}', '{}'), ['removed a']);
    assert.deepStrictEqual(diff('{"a":1}', '{"a":null}'), ['changed a']);
});

test('arrays are matched by id: an insertion at the top is one change, not many', () => {
    const before = '{"orders":[{"id":1,"t":10},{"id":2,"t":20},{"id":3,"t":30}]}';
    const after = '{"orders":[{"id":0,"t":5},{"id":1,"t":10},{"id":2,"t":21},{"id":3,"t":30}]}';
    assert.deepStrictEqual(diff(before, after), ['changed orders[id=2].t', 'added orders[id=0]']);
    assert.ok(diff(before, after, { arrayMatch: 'index' }).length > 2);
    assert.deepStrictEqual(D.diffDocuments(parse(before), parse(after)).matchedBy, ['id']);
});

test('reordered records with the same content are not changes when matched by id', () => {
    assert.deepStrictEqual(diff('[{"id":"a","v":1},{"id":"b","v":2}]', '[{"id":"b","v":2},{"id":"a","v":1}]'), []);
});

test('no match field when ids repeat or are missing, so arrays fall back to index', () => {
    assert.strictEqual(D.detectMatchField(parse('[{"id":1},{"id":1}]'), parse('[]')), null);
    assert.strictEqual(D.detectMatchField(parse('[{"id":1},{"x":2}]'), parse('[]')), null);
    assert.strictEqual(D.detectMatchField(parse('[{"sku":"A"},{"sku":"B"}]'), parse('[{"sku":"B"}]')), 'sku');
});

test('duplicate keys: last value wins, and the duplicate is reported', () => {
    const n = parse('{"a":1,"a":2,"b":{"c":1,"c":1}}');
    assert.strictEqual(D.nodeToJson(n), '{"a":2,"b":{"c":1}}');
    assert.deepStrictEqual(D.findDuplicateKeys(n), ['a', 'b.c']);
});

test('JSON Patch removes several trailing elements in a valid order', () => {
    const a = parse('{"x":[1,2,3,4,5]}');
    const b = parse('{"x":[1,2]}');
    const ops = D.toJsonPatch(a, b);
    assert.deepStrictEqual(ops.map(o => o.op + ' ' + o.path), ['remove /x/4', 'remove /x/3', 'remove /x/2']);
    assert.strictEqual(canon(applyPatch(a, ops)), canon(b));
});

test('JSON Patch escapes pointer segments and keeps numbers exact', () => {
    const ops = D.toJsonPatch(parse('{"a/b":1,"t~":2}'), parse('{"a/b":1839274619283746818,"t~":2}'));
    assert.strictEqual(D.formatJsonPatch(ops), '[\n  { "op": "replace", "path": "/a~1b", "value": 1839274619283746818 }\n]');
});

test('structure diff classifies breaking and safe changes', () => {
    const before = '{"users":[{"id":1,"email":"a@x","closed":null},{"id":2,"email":"b@x","closed":"2026"}],"meta":{"v":1}}';
    const after = '{"users":[{"id":"1","closed":"2026","tag":"x"},{"id":"2","email":null,"closed":"2026","tag":"y"}],"meta":{"v":2}}';
    const got = D.diffStructure(parse(before), parse(after)).map(s => s.id + ': ' + s.change + (s.breaking ? ' !' : ''));
    assert.deepStrictEqual(got, [
        'users[].email: Became nullable !',
        'users[].email: Became optional !',
        'users[].id: Type changed !',
        'users[].closed: No longer null',
        'users[].tag: Field added'
    ]);
});

test('structure diff details read correctly when null was or becomes the only type', () => {
    const detail = (x, y) => D.diffStructure(parse(x), parse(y)).map(s => s.change + ': ' + s.detail);
    assert.deepStrictEqual(detail('{"offset":null}', '{"offset":3}'), ['No longer null: null \u2192 number']);
    assert.deepStrictEqual(detail('{"a":"x"}', '{"a":null}'), ['Became nullable: string \u2192 null']);
    assert.deepStrictEqual(detail('[{"a":"x"},{"a":"y"}]', '[{"a":"x"},{"a":null}]'), ['Became nullable: string \u2192 string | null']);
    assert.deepStrictEqual(detail('[{"a":1},{"a":null}]', '[{"a":1},{"a":2}]'), ['No longer null: number | null \u2192 number']);
});

test('structure diff reports a removed object once, not every field inside it', () => {
    const got = D.diffStructure(parse('{"a":{"b":1,"c":{"d":2}}}'), parse('{}')).map(s => s.id + ': ' + s.change);
    assert.deepStrictEqual(got, ['a: Field removed']);
});

test('markdown report', () => {
    const a = parse('{"a":1,"b":2}');
    const b = parse('{"a":1,"b":3,"c":4}');
    const md = D.changesToMarkdown(D.diffDocuments(a, b), D.diffStructure(a, b));
    assert.ok(md.includes('1 added, 0 removed, 1 changed.'), md);
    assert.ok(md.includes('- **changed** `b`: `2` → `3`'), md);
});

console.log(passed + ' tests passed' + (process.exitCode ? ', some failed' : ''));
