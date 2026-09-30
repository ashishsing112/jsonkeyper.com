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

// Flags that take a value, and what the value means.
const CURL_VALUE_FLAGS = {
    '-X': 'method', '--request': 'method',
    '-H': 'header', '--header': 'header',
    '-d': 'data', '--data': 'data', '--data-ascii': 'data', '--data-binary': 'data',
    '--data-raw': 'data-raw',
    '--data-urlencode': 'data-urlencode',
    '--json': 'json',
    '-u': 'user', '--user': 'user',
    '-A': 'user-agent', '--user-agent': 'user-agent',
    '-e': 'referer', '--referer': 'referer',
    '-b': 'cookie', '--cookie': 'cookie',
    '--url': 'url'
};

// Flags that take a value this tool has no use for (output, timing, TLS,
// retries). The value is skipped so it is never mistaken for the URL.
const CURL_IGNORED_VALUE_FLAGS = new Set([
    '-o', '--output', '-m', '--max-time', '--connect-timeout', '--retry', '--retry-delay',
    '-w', '--write-out', '-c', '--cookie-jar', '--cacert', '--capath', '--cert', '--key',
    '-x', '--proxy', '--limit-rate', '--resolve', '--max-redirs', '--http-version'
]);

// Options that change the request in a way the proxy cannot reproduce. These
// fail loudly rather than sending a different request from the one written.
const CURL_UNSUPPORTED_FLAGS = {
    '-F': 'multipart form uploads (-F) are not supported - send the body with -d or --json instead',
    '--form': 'multipart form uploads (--form) are not supported - send the body with -d or --json instead',
    '-T': 'file uploads (-T) are not supported',
    '--upload-file': 'file uploads (--upload-file) are not supported'
};

// Flags that take no value: -G and -I change the request; the rest only change
// how curl prints or transports it, so they can be skipped.
const CURL_SWITCHES = {
    '-G': 'get', '--get': 'get',
    '-I': 'head', '--head': 'head'
};

function base64Utf8(text) {
    return btoa(unescape(encodeURIComponent(text)));
}

// Percent-encodes the way curl does for --data-urlencode: everything except
// A-Z a-z 0-9 - . _ ~ is escaped, with lowercase hex, and spaces become "+".
function curlEscape(text) {
    return encodeURIComponent(text)
        .replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16))
        .replace(/%[0-9A-F]{2}/g, esc => esc.toLowerCase())
        .replace(/%20/g, '+');
}

// curl's --data-urlencode forms: "content", "=content", "name=content".
// The @file forms read a local file, which a browser page cannot do.
function urlencodeData(value) {
    if (/^[^=]*@/.test(value)) {
        throw new Error('--data-urlencode with @file reads a local file, which is not supported - paste the content instead.');
    }
    const eq = value.indexOf('=');
    if (eq === -1) {
        return curlEscape(value);
    }
    const name = value.slice(0, eq);
    const content = curlEscape(value.slice(eq + 1));
    return name ? name + '=' + content : content;
}

function hasHeader(headers, name) {
    return Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase());
}

// Splits a short flag with its value attached, like "-XPOST" or "-HAccept: x".
// curl has no "--long=value" form and rejects it, so this does too rather than
// quietly accepting a command that fails in a terminal.
function splitAttachedValue(token) {
    if (token.startsWith('--')) {
        const eq = token.indexOf('=');
        if (eq !== -1 && CURL_VALUE_FLAGS[token.slice(0, eq)]) {
            throw new Error('curl does not accept "' + token.slice(0, eq) + '=value" - write "' + token.slice(0, eq) + ' value" with a space.');
        }
        return [token, undefined];
    }
    if (token.length > 2 && CURL_VALUE_FLAGS[token.slice(0, 2)]) {
        return [token.slice(0, 2), token.slice(2)];
    }
    return [token, undefined];
}

function parseCurlCommand(curlString) {
    if (typeof curlString !== 'string' || !curlString.trim()) {
        throw new Error('Paste a curl command first.');
    }

    // Join backslash (bash) and caret (Windows cmd) line-continuations before tokenizing.
    const joined = curlString.trim().replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');

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
    const data = [];
    let json = null;
    let user = null;
    let userAgent = null;
    let referer = null;
    const cookies = [];
    let getMode = false;
    let headMode = false;

    for (let i = 0; i < tokens.length; i++) {
        const [token, attached] = splitAttachedValue(tokens[i]);

        if (CURL_UNSUPPORTED_FLAGS[token]) {
            throw new Error(CURL_UNSUPPORTED_FLAGS[token] + '.');
        }
        if (CURL_SWITCHES[token]) {
            if (CURL_SWITCHES[token] === 'get') {
                getMode = true;
            } else {
                headMode = true;
            }
            continue;
        }
        if (CURL_IGNORED_VALUE_FLAGS.has(token)) {
            i++;
            continue;
        }

        const kind = CURL_VALUE_FLAGS[token];
        if (kind) {
            const value = attached !== undefined ? attached : tokens[++i];
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
                if (value.startsWith('@')) {
                    throw new Error(token + ' ' + value + ' reads a local file, which is not supported - paste the content instead, or use --data-raw.');
                }
                data.push(value);
            } else if (kind === 'data-raw') {
                data.push(value);
            } else if (kind === 'data-urlencode') {
                data.push(urlencodeData(value));
            } else if (kind === 'json') {
                if (value.startsWith('@')) {
                    throw new Error('--json ' + value + ' reads a local file, which is not supported - paste the JSON instead.');
                }
                json = (json || '') + value;
            } else if (kind === 'user') {
                user = value;
            } else if (kind === 'user-agent') {
                userAgent = value;
            } else if (kind === 'referer') {
                referer = value;
            } else if (kind === 'cookie') {
                if (value.indexOf('=') === -1) {
                    throw new Error('-b "' + value + '" names a cookie file, which is not supported - pass the cookies themselves, e.g. -b "name=value".');
                }
                cookies.push(value);
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

    // Explicit -H headers win over the shorthand flags, as they do in curl.
    if (user !== null && !hasHeader(headers, 'Authorization')) {
        headers['Authorization'] = 'Basic ' + base64Utf8(user.indexOf(':') === -1 ? user + ':' : user);
    }
    if (userAgent !== null && !hasHeader(headers, 'User-Agent')) {
        headers['User-Agent'] = userAgent;
    }
    if (referer !== null && !hasHeader(headers, 'Referer')) {
        headers['Referer'] = referer;
    }
    if (cookies.length) {
        const existing = Object.keys(headers).find(k => k.toLowerCase() === 'cookie');
        headers[existing || 'Cookie'] = (existing ? headers[existing] + ';' : '') + cookies.join(';');
    }

    let body = null;
    if (json !== null) {
        body = data.length ? data.join('&') + json : json;
        if (!hasHeader(headers, 'Content-Type')) {
            headers['Content-Type'] = 'application/json';
        }
        if (!hasHeader(headers, 'Accept')) {
            headers['Accept'] = 'application/json';
        }
    } else if (data.length) {
        body = data.join('&');
    }

    // -G sends the data as a query string on a GET instead of as a body.
    if (getMode && body !== null) {
        url += (url.indexOf('?') === -1 ? '?' : '&') + body;
        body = null;
    }

    if (!method) {
        method = headMode ? 'HEAD' : body !== null ? 'POST' : 'GET';
    }

    return {
        url: url,
        method: method,
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
