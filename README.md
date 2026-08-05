# jsonkeyper.com

A free, browser-based JSON key extractor. Paste any JSON object and get every
key path it contains - including keys buried inside nested objects and arrays -
rendered as dot notation, JSONPath, an indented tree, or a generated TypeScript
interface.

Live at **[jsonkeyper.com](https://jsonkeyper.com)**.

Everything runs client side. No JSON is uploaded, logged, or stored anywhere;
the page keeps working with the network disconnected.

## Features

| Output format | What it gives you |
| --- | --- |
| Key paths | `user.address.city`, `orders[0].total` - paste straight into code |
| Key paths with value types | The same paths annotated `string`, `number`, `object`, ... |
| Unique key names | A sorted, deduplicated vocabulary of every key name |
| JSONPath | `$.user.address.city`, with `[*]` wildcards when indices are collapsed |
| Indented tree | A visual read of shape and nesting depth |
| TypeScript interface | A generated `interface Root { ... }` from your sample |

Alongside those:

- **Collapse array indices** - merges `items[0].sku` and `items[1].sku` into a
  single `items[].sku`, which is what you want when documenting a schema rather
  than inspecting one record.
- **Structure statistics** - total key paths, unique key names, maximum nesting
  depth, object and array counts, and payload size.
- **Input options** - paste, drag a `.json` file onto the input box, use the file
  picker, or load the built-in sample. `Ctrl` / `Cmd` + `Enter` extracts.
- **Useful parse errors** - reports the line and column of malformed JSON rather
  than a generic failure.
- **Copy or download** - to the clipboard, or as `.txt` (`.ts` for the TypeScript
  format).

The TypeScript generator merges objects across an array and marks any key absent
from some elements as optional, so a `giftMessage` present on only one of two
orders is emitted as `giftMessage?: string`.

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

## Repository layout

```
index.html          Tool plus reference content, FAQ, and structured data
script.js           Traversal, output formatters, and UI wiring (no dependencies)
styles.css          All custom styling; Bootstrap 4.5.2 is loaded from a CDN
about.html          Project background, capabilities, limitations, author
contact.html        Contact form (composes a mailto:)
privacy.html        Privacy policy
terms.html          Terms of service
blog/index.html     Article listing
blog/*.html         Eight long-form guides on working with JSON
sitemap.xml         Kept in sync by hand when pages are added
robots.txt          Allows all crawlers, points at the sitemap
CNAME               Custom domain for GitHub Pages
```

There is no build step, no bundler, and no package manifest - the files served
are the files in the repository.

## Running locally

Any static file server works. The site uses root-relative links (`/blog/`), so
serve from the repository root rather than opening `index.html` over `file://`:

```bash
python3 -m http.server 8000
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
- **Use hyphens, not em dashes,** in page copy. `replace-emdash.sh` exists to fix
  this after the fact.
- **Update `sitemap.xml`** when you add or remove a page.
- **Keep dates honest.** Article `datePublished` / `dateModified` values, visible
  bylines, and sitemap `lastmod` entries must reflect when the content was
  actually written.
- **Test the tool before opening a PR.** `script.js` exposes plain functions, so
  the formatters can be exercised directly under Node without a browser.

## License

[MIT](LICENSE) - Ashish Singh.
