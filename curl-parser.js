/* JSON Keyper - self-contained cURL command parser.
   No dependencies. Turns a pasted `curl ...` string into
   { url, method, headers, body } for the proxy Worker. */

function tokenizeCurl(input) {
    const tokens = [];
    let current = '';
    let quote = null;
    let hasToken = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (quote) {
            if (char === '\\' && quote === '"' && i + 1 < input.length && '"\\$`'.indexOf(input[i + 1]) !== -1) {
                current += input[i + 1];
                i++;
                continue;
            }
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            hasToken = true;
            continue;
        }

        if (char === '\\' && i + 1 < input.length) {
            current += input[i + 1];
            i++;
            hasToken = true;
            continue;
        }

        if (/\s/.test(char)) {
            if (hasToken) {
                tokens.push(current);
                current = '';
                hasToken = false;
            }
            continue;
        }

        current += char;
        hasToken = true;
    }

    if (quote) {
        throw new Error('unterminated ' + quote + ' quote');
    }
    if (hasToken) {
        tokens.push(current);
    }

    return tokens;
}

const CURL_VALUE_FLAGS = {
    '-X': 'method', '--request': 'method',
    '-H': 'header', '--header': 'header',
    '-d': 'data', '--data': 'data', '--data-raw': 'data',
    '--data-binary': 'data', '--data-urlencode': 'data',
    '--url': 'url'
};

// Flags that take a value but that this parser deliberately ignores
// (auth, timing, TLS options - not part of {url, method, headers, body}).
const CURL_IGNORED_VALUE_FLAGS = new Set(['-u', '--user', '-A', '--user-agent', '-e', '--referer']);

// Flags that take no value and can simply be skipped.
const CURL_IGNORED_FLAGS = new Set([
    '--compressed', '-s', '--silent', '-k', '--insecure',
    '-i', '--include', '-L', '--location', '-v', '--verbose', '-#', '--progress-bar'
]);

function parseCurlCommand(curlString) {
    if (typeof curlString !== 'string' || !curlString.trim()) {
        throw new Error('Paste a curl command first.');
    }

    // Join backslash line-continuations before tokenizing.
    const joined = curlString.trim().replace(/\\\r?\n/g, ' ');

    let tokens;
    try {
        tokens = tokenizeCurl(joined);
    } catch (e) {
        throw new Error('Could not tokenize the command (' + e.message + ').');
    }

    if (tokens.length && tokens[0].toLowerCase() === 'curl') {
        tokens.shift();
    }
    if (!tokens.length) {
        throw new Error('Could not find a curl command.');
    }

    let url = null;
    let method = null;
    const headers = {};
    let body = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (CURL_IGNORED_FLAGS.has(token)) {
            continue;
        }

        if (CURL_IGNORED_VALUE_FLAGS.has(token)) {
            i++;
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(CURL_VALUE_FLAGS, token)) {
            const kind = CURL_VALUE_FLAGS[token];
            const value = tokens[++i];
            if (value === undefined) {
                throw new Error('"' + token + '" is missing its value.');
            }
            if (kind === 'method') {
                method = value.toUpperCase();
            } else if (kind === 'header') {
                const sep = value.indexOf(':');
                if (sep === -1) {
                    throw new Error('Header "' + value + '" is missing a colon.');
                }
                headers[value.slice(0, sep).trim()] = value.slice(sep + 1).trim();
            } else if (kind === 'data') {
                body = body === null ? value : body + '&' + value;
                if (!method) {
                    method = 'POST';
                }
            } else if (kind === 'url') {
                url = value;
            }
            continue;
        }

        // Unrecognized flag - skip it, don't consume a value we can't identify.
        if (token.charAt(0) === '-' && token.length > 1) {
            continue;
        }

        if (!url) {
            url = token;
        }
    }

    if (!url) {
        throw new Error('Could not find a URL in that curl command.');
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new Error('The URL must start with http:// or https://');
    }

    return {
        url: url,
        method: method || 'GET',
        headers: headers,
        body: body
    };
}

if (typeof window !== 'undefined') {
    window.parseCurlCommand = parseCurlCommand;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseCurlCommand: parseCurlCommand, tokenizeCurl: tokenizeCurl };
}
