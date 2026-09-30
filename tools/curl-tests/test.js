/* Tests for curl-parser.js. No dependencies:

       node tools/curl-tests/test.js

   Every expected request below was checked against what curl 8.5 actually
   sends, by running the same command against a local echo server. */
const assert = require('assert');
const { parseCurlCommand } = require('../../curl-parser.js');

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

const parse = cmd => parseCurlCommand(cmd);
const fails = (cmd, pattern) => assert.throws(() => parseCurlCommand(cmd), pattern);

test('plain GET', () => {
    assert.deepStrictEqual(parse('curl https://api.example.com/users/1'),
        { url: 'https://api.example.com/users/1', method: 'GET', headers: {}, body: null });
});

test('-u becomes Basic auth, and an explicit Authorization header wins', () => {
    assert.strictEqual(parse('curl -u alice:s3cret https://a.example').headers.Authorization, 'Basic YWxpY2U6czNjcmV0');
    assert.strictEqual(parse("curl -u a:b -H 'Authorization: Bearer tok' https://a.example").headers.Authorization, 'Bearer tok');
});

test('-A and -e set User-Agent and Referer; -H User-Agent wins over -A', () => {
    const r = parse('curl -A myapp/1.0 -e https://ref.example/ https://a.example');
    assert.strictEqual(r.headers['User-Agent'], 'myapp/1.0');
    assert.strictEqual(r.headers.Referer, 'https://ref.example/');
    assert.strictEqual(parse("curl -H 'User-Agent: explicit' -A ignored https://a.example").headers['User-Agent'], 'explicit');
});

test('-d sends a POST body; repeated -d join with &', () => {
    const r = parse('curl -XPOST https://a.example/x -d a=1 -d b=2');
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.body, 'a=1&b=2');
});

test('-G moves data into the query string of a GET', () => {
    const r = parse("curl -G --data-urlencode 'q=hello world' --data-urlencode '=a&b' -d page=2 https://a.example/search");
    assert.strictEqual(r.method, 'GET');
    assert.strictEqual(r.body, null);
    assert.strictEqual(r.url, 'https://a.example/search?q=hello+world&a%26b&page=2');
    assert.strictEqual(parse('curl -G https://a.example/q?x=1 -d y=2').url, 'https://a.example/q?x=1&y=2');
});

test('--data-urlencode escapes exactly as curl does', () => {
    const url = cmd => parse(cmd).url;
    assert.strictEqual(url(`curl -G --data-urlencode "note=it's (fine)! *ok*" https://a.example/e`), 'https://a.example/e?note=it%27s+%28fine%29%21+%2aok%2a');
    assert.strictEqual(url("curl -G --data-urlencode 'city=Zürich & São Paulo' https://a.example/e"), 'https://a.example/e?city=Z%c3%bcrich+%26+S%c3%a3o+Paulo');
    assert.strictEqual(url("curl -G --data-urlencode '=raw/value?x=1' https://a.example/e"), 'https://a.example/e?raw%2fvalue%3fx%3d1');
});

test('--json sets the body, Content-Type and Accept, and implies POST', () => {
    assert.deepStrictEqual(parse(`curl --json '{"a":1}' https://a.example/items`), {
        url: 'https://a.example/items', method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{"a":1}'
    });
});

test('-b sends cookies, joined as curl joins them', () => {
    assert.strictEqual(parse("curl -b 'session=abc' -b 'theme=dark' https://a.example").headers.Cookie, 'session=abc;theme=dark');
});

test('-I is a HEAD request', () => {
    assert.strictEqual(parse('curl -I https://a.example/h').method, 'HEAD');
});

test('attached short values: -XPOST and -HAccept', () => {
    const r = parse("curl -XPOST -H'Accept: application/json' https://a.example");
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.headers.Accept, 'application/json');
});

test('--data-raw keeps a leading @ literally', () => {
    assert.strictEqual(parse("curl -X PUT --data-raw '@not-a-file' https://a.example").body, '@not-a-file');
});

test('multi-line commands with bash and Windows continuations', () => {
    assert.strictEqual(parse('curl https://a.example \\\n  -H "X-A: 1"').headers['X-A'], '1');
    assert.strictEqual(parse('curl https://a.example ^\n  -H "X-A: 1"').headers['X-A'], '1');
});

test('output and timing flags are skipped along with their values', () => {
    assert.deepStrictEqual(parse('curl -sSL -o out.json -m 10 -w "%{http_code}" https://a.example'),
        { url: 'https://a.example', method: 'GET', headers: {}, body: null });
});

test('things curl would do that a browser page cannot fail loudly', () => {
    fails('curl -F file=@a.txt https://a.example/upload', /multipart form uploads/);
    fails('curl -T big.bin https://a.example', /file uploads/);
    fails('curl -d @body.json https://a.example', /reads a local file/);
    fails("curl --json @body.json https://a.example", /reads a local file/);
    fails('curl --data-urlencode name@file https://a.example', /reads a local file/);
    fails('curl -b cookies.txt https://a.example', /cookie file/);
});

test('--flag=value is rejected, as curl rejects it', () => {
    fails("curl --header='X-A: 1' https://a.example", /does not accept/);
});

test('URL errors', () => {
    fails('curl -H "X: 1"', /Could not find a URL/);
    fails('curl ftp://a.example/file', /must start with http/);
    fails('curl "https://a.example', /unterminated/);
});

console.log(passed + ' tests passed' + (process.exitCode ? ', some failed' : ''));
