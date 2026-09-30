# jsonkeyper.com

A free, browser-based set of JSON tools. Paste any JSON document and get every
key path it contains - including keys buried inside nested objects and arrays -
rendered as dot notation, JSONPath, an indented tree, or a generated TypeScript
type; pretty-print and minify it without changing a single value; or compare two
versions of it and see which changes would break the code that reads it.

Eight tools share one engine: Key Extractor (the homepage), Run cURL, Formatter,
Diff, Flattener, JSONPath Generator, Tree Viewer, and JSON to TypeScript. Alongside
them is a blog of tested, long-form guides on working with JSON.

Live at **[jsonkeyper.com](https://jsonkeyper.com)**.

Pasted JSON is processed entirely client side. It is never uploaded, logged, or
stored, and that flow keeps working with the network disconnected. The one
exception is the optional Execute cURL tab, which sends a request through a
proxy to fetch a live API response (see [Repository layout](#repository-layout)).

## Features

| Output format | What it gives you |
| --- | --- |
| Key paths | `user.address.city`, `orders[0].total` - paste straight into code |
| Key paths with value types | The same paths annotated `string`, `number`, `object`, ... |
| Unique key names | A sorted, deduplicated vocabulary of every key name |
| JSONPath | `$.user.address.city`, with `[*]` wildcards when indices are collapsed |
| Indented tree | A visual read of shape and nesting depth |
| TypeScript interface | A generated `interface Root { ... }` from your sample |
| Formatted / minified JSON | The JSON itself, re-indented (2 or 4 spaces) or on one line |

Alongside those:

- **Collapse array indices** - merges `items[0].sku` and `items[1].sku` into a
  single `items[].sku`, which is what you want when documenting a schema rather
  than inspecting one record.
- **Structure statistics** - total key paths, unique key names, maximum nesting
  depth, object and array counts, and payload size.
- **Input options** - paste, drag a `.json` file onto the input box, use the file
  picker, or load the built-in sample. `Ctrl` / `Cmd` + `Enter` runs the tool.
- **Execute cURL** - paste a curl command to fetch a live API response through a
  CORS proxy, preview the status, headers, and body, then extract keys from it.
  It has its own page, `/execute-curl`, and is also a tab on the homepage
  (`/?mode=curl` opens it). The parser handles `-X`, `-H`, `-d` and its
  variants, `--data-urlencode`, `--json`, `-G`, `-I`, `-u`, `-A`, `-e`, and `-b`,
  sending what curl 8.5 sends; options that read local files are refused with
  an explanation. A default `User-Agent` is added when the command sets none.
- **Useful parse errors** - reports the line and column of malformed JSON rather
  than a generic failure.
- **Copy or download** - to the clipboard, or as `json-keys.txt` (`.ts` for the
  TypeScript format, `formatted.json` for the formatted and minified outputs).
  JSON Diff downloads a Markdown report (`json-diff.md`) or the patch
  (`json-patch.json`).
- **Moving between tools** - a tab strip under the header on every tool page, and
  a "JSON Tools" directory on the homepage. JSON already pasted comes along: it is
  parked in `sessionStorage` for that tab, read once by the next tool, and deleted.
  On JSON Diff it arrives as the Original, ready for the second document.

The TypeScript generator merges objects across an array and marks any key absent
from some elements as optional, so a `giftMessage` present on only one of two
orders is emitted as `giftMessage?: string`. A key that is present but `null` on
some elements stays required and gains `| null` instead, and arrays nested in
those elements pool their items, so an empty `labels: []` on one record does not
hide the element type seen on another.

JSON Diff (`/json-diff`, code in `diff.js`) compares two documents three ways:
a list of added, removed, and changed values; a structure diff that flags
breaking changes (a field removed, retyped, newly nullable, or newly optional);
and an RFC 6902 JSON Patch. Key order is ignored, array items are paired by an
identifying field (`id`, `uuid`, `sku`, ...) when every item has a unique one,
and a small parser keeps number literals and duplicate keys, so numbers are
compared exactly as written.

The formatted and minified outputs never re-serialise: `formatJsonText` walks the
original text and changes only whitespace outside strings, so integers above
2^53, trailing zeros such as `12.50`, key order, and duplicate keys survive
exactly. `JSON.parse` still runs first, to report errors.

### Known limitations

These are deliberate, and documented on the site itself:

- Type inference describes the **sample you paste**, not the API's real contract.
  A field that happens to be `null` in your sample is typed `null`.
- The full path list is built in memory, so documents in the tens of megabytes
  may be slow. Use a streaming tool such as `jq` at that scale.
- JSON does not distinguish integers from floats, so every number is `number`.
- Dot-notation output is ambiguous for keys that themselves contain a dot. The
  JSONPath output quotes those instead.
- It validates that JSON *parses*; it does not validate against a JSON Schema.
- Execute cURL only reaches public `http`/`https` URLs on ports 80 and 443, times
  out after 5 seconds, and rejects responses over 2 MB.
- JSON Diff compares two documents; it does not merge three. Changed strings are
  shown whole rather than character by character, and the patch uses `replace`
  rather than `move` for reordered arrays, which is correct but longer.

## URLs

Pages are addressed without `.html` (`/about`, `/blog/cors-explained`): GitHub
Pages serves `about.html` for `/about`. Every internal link, canonical tag,
`og:url`, JSON-LD URL, and sitemap `<loc>` uses the clean form. GitHub Pages
cannot redirect, so each page (except `404.html`) carries a small inline script
that rewrites an old `.html` address in the address bar with
`history.replaceState`, without reloading.

## Repository layout

```
index.html                Tool plus reference content, FAQ, and structured data
script.js                 Traversal, output formatters, and UI wiring (no dependencies)
diff.js                   JSON Diff: preserving parser, value/structure diff, JSON Patch, page UI
nav.js                    Navbar collapse toggle, loaded by every page
curl-parser.js            Self-contained curl command string parser, no dependencies
curl-proxy.js             Execute cURL tab: proxy request/response UI, wired to curl-parser.js
styles.css                All custom styling; Bootstrap 4.5.2 CSS is loaded from a CDN

json-flattener.html       Tool page: dot-notation key paths (payment webhook example)
json-to-typescript.html   Tool page: TypeScript generation (issue-tracker example)
jsonpath-generator.html   Tool page: JSONPath expressions (Kubernetes pod list example)
json-tree-viewer.html     Tool page: indented structural tree (GeoJSON example)
json-formatter.html       Tool page: pretty-print and minify (event feed example)
                          Each of the five above embeds the tool with its format
                          preselected, and its own sample in <script
                          id="pageSample">, which loadSample() loads verbatim in
                          place of the homepage sample (a parse/stringify round
                          trip would alter it)
execute-curl.html         Tool page: the Execute cURL tab opened by default, with the
                          proxy's options, behaviour, and limits documented
json-diff.html            Tool page: two-document diff with its own two-input UI
                          (diff.js); its payouts API v1/v2 example is in <script
                          id="diffExample">

about.html                Author background and work history, how the guides are written
contact.html              Contact form (composes a mailto:)
privacy.html              Privacy policy
terms.html                Terms of service
changelog.html            User-facing change history, newest first
404.html                  Not-found page; GitHub Pages serves it automatically
blog/index.html           Article listing
blog/*.html               Twelve long-form guides on working with JSON

og-image.png              1200x630 social card referenced by og:image on every page
sitemap.xml               Kept in sync by hand when pages are added
robots.txt                Allows all crawlers, points at the sitemap
ads.txt                   AdSense seller declaration
CNAME                     Custom domain for GitHub Pages

tools/serve.py            Local server that resolves clean URLs like GitHub Pages
tools/check-sitemap.py    Reports sitemap lastmod values older than the file's last commit
tools/diff-tests/         Tests for diff.js: node tools/diff-tests/test.js
tools/curl-tests/         Tests for curl-parser.js, checked against real curl
tools/json-vs-xml-bench/  Reproduces the measurements in blog/json-vs-xml.html
tools/model-mismatch/     Reproduces blog/null-missing-unknown-fields.html in
                          Jackson 2 and 3, Pydantic, and Zod (see its README)
```

There is no build step, no bundler, and no package manifest - the files served
are the files in the repository. The homepage and the seven tool pages load
`script.js`; the diff page also loads `diff.js`, and the homepage and
`/execute-curl` also load `curl-parser.js` and `curl-proxy.js`; every page loads
`nav.js`. Bootstrap's CSS is still used from a CDN, but its JavaScript, jQuery,
and Popper were removed because the navbar toggle was the only behaviour that
depended on them.

The homepage's Execute cURL tab sends the parsed request to a Cloudflare Worker
(`jsonkeyper-worker`, deployed separately - not in this repository) that proxies
the request server-side to work around browser CORS. It is the only feature on
the site that transmits data off the visitor's device; see the [privacy
policy](https://jsonkeyper.com/privacy#curl-proxy-feature) for what it does
and does not do with that request.

## Running locally

Internal links are root-relative and extensionless (`/about`, `/blog/`), so a
plain `python3 -m http.server` will 404 on them. Use the bundled server, which
resolves URLs the same way GitHub Pages does:

```bash
python3 tools/serve.py
# then open http://localhost:8000
```

## Deployment

Pushes to `main` trigger [`.github/workflows/static.yml`](.github/workflows/static.yml),
which publishes the whole repository to GitHub Pages. There is no staging
environment, so **a merge to `main` goes live immediately**. Work on a branch and
open a pull request.

## Contributing

Issues and pull requests are welcome. A few conventions worth knowing:

- **Match the existing style.** Vanilla JS with inline `onclick` handlers for the
  tool controls, four-space indentation, and no new runtime dependencies.
- **Use hyphens, not em dashes,** in page copy.
- **Link without `.html`** (`/about`, not `/about.html`), and use the same clean
  form in canonical tags, `og:url`, and JSON-LD. New pages also need the
  address-bar script from the top of any existing page's `<head>`.
- **Update `sitemap.xml`** when you add or remove a page, and run
  `python3 tools/check-sitemap.py` to catch stale `lastmod` values.
- **Keep dates honest.** Article `datePublished` / `dateModified` values, visible
  bylines, and sitemap `lastmod` entries must reflect when the content was
  actually written.
- **Test the tool before opening a PR.** `script.js` and `diff.js` expose plain
  functions, so they can be exercised directly under Node without a browser. Run
  `node tools/diff-tests/test.js` after touching `diff.js`, and
  `node tools/curl-tests/test.js` after touching `curl-parser.js`.

## Support

JSON Keyper is free, with no accounts. If it saves you time, you can
[sponsor it on GitHub](https://github.com/sponsors/ashishsing112).

## License

[MIT](LICENSE) - Ashish Singh.
