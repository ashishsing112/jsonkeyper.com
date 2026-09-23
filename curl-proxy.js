/* JSON Keyper - cURL proxy integration.
   Parses a pasted curl command, executes it through the jsonkeyper-worker
   Cloudflare Worker (the only network call this site ever makes), and offers
   the response to the existing key-extraction pipeline. The Worker enforces
   its own SSRF/scheme/port allowlist server side; nothing here is a security
   boundary, only UX. */

const CURL_WORKER_URL = 'https://jsonkeyper-worker.ashishsing112.workers.dev/api/proxy';
const CURL_SAMPLE = 'curl https://jsonplaceholder.typicode.com/users/1';

let lastCurlResponseBody = null;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ---------------------------------------------------------------------------
   Mode toggle
--------------------------------------------------------------------------- */

function setInputMode(mode) {
    const jsonPanel = document.getElementById('jsonModePanel');
    const curlPanel = document.getElementById('curlModePanel');
    const jsonTab = document.getElementById('modeTabJson');
    const curlTab = document.getElementById('modeTabCurl');
    if (!jsonPanel || !curlPanel || !jsonTab || !curlTab) {
        return;
    }
    const isCurl = mode === 'curl';
    jsonPanel.hidden = isCurl;
    curlPanel.hidden = !isCurl;
    jsonTab.classList.toggle('active', !isCurl);
    curlTab.classList.toggle('active', isCurl);
    jsonTab.setAttribute('aria-selected', String(!isCurl));
    curlTab.setAttribute('aria-selected', String(isCurl));
}

function loadCurlSample() {
    document.getElementById('curlInput').value = CURL_SAMPLE;
}

/* ---------------------------------------------------------------------------
   Errors
--------------------------------------------------------------------------- */

function showCurlError(message) {
    const box = document.getElementById('curlErrorBox');
    if (box) {
        box.textContent = message;
        box.classList.add('show');
    }
    showToast(message);
}

function clearCurlError() {
    const box = document.getElementById('curlErrorBox');
    if (box) {
        box.textContent = '';
        box.classList.remove('show');
    }
}

const CURL_ERROR_MESSAGES = {
    400: 'That request was rejected - usually an invalid URL, a private or internal address (blocked for security), or a malformed body.',
    404: 'The proxy endpoint was not found. It may have moved.',
    413: 'The response was too large (over 2 MB). Try an endpoint that returns less data.',
    502: 'Could not reach the target API. Check the URL and try again.',
    504: 'The API took too long to respond (5-second limit). Try again or use a different endpoint.'
};

/* ---------------------------------------------------------------------------
   Rendering
--------------------------------------------------------------------------- */

function renderCurlPreview(parsed) {
    const box = document.getElementById('curlPreview');
    if (!box) {
        return;
    }
    const headerRows = Object.keys(parsed.headers).map(k =>
        '<div class="curl-preview-row"><span class="curl-preview-key">' + escapeHtml(k) +
        '</span><span>' + escapeHtml(parsed.headers[k]) + '</span></div>'
    ).join('');
    box.innerHTML =
        '<div class="curl-preview-row"><span class="curl-preview-key">Method</span><span>' + escapeHtml(parsed.method) + '</span></div>' +
        '<div class="curl-preview-row"><span class="curl-preview-key">URL</span><span>' + escapeHtml(parsed.url) + '</span></div>' +
        headerRows +
        (parsed.body ? '<div class="curl-preview-row"><span class="curl-preview-key">Body</span><span>' + escapeHtml(parsed.body) + '</span></div>' : '');
    box.hidden = false;
}

function statusClass(status) {
    if (status >= 200 && status < 300) return 'curl-status-2xx';
    if (status >= 300 && status < 400) return 'curl-status-3xx';
    if (status >= 400 && status < 500) return 'curl-status-4xx';
    return 'curl-status-5xx';
}

function headerValue(headers, name) {
    if (!headers) {
        return '';
    }
    const key = Object.keys(headers).find(k => k.toLowerCase() === name);
    return key ? headers[key] : '';
}

function isJsonContentType(headers) {
    return headerValue(headers, 'content-type').toLowerCase().indexOf('json') !== -1;
}

function isBinaryContentType(headers) {
    const type = headerValue(headers, 'content-type').toLowerCase();
    return /^(image|audio|video|font)\//.test(type) ||
        type.indexOf('application/octet-stream') !== -1 ||
        type.indexOf('application/pdf') !== -1;
}

function renderCurlResponse(result) {
    const panel = document.getElementById('curlResponsePanel');
    if (!panel) {
        return;
    }
    lastCurlResponseBody = typeof result.body === 'string' ? result.body : '';

    const headers = result.headers || {};
    const binary = isBinaryContentType(headers);
    const json = !binary && isJsonContentType(headers);

    let bodyPreview = lastCurlResponseBody;
    if (json) {
        try {
            bodyPreview = JSON.stringify(JSON.parse(lastCurlResponseBody), null, 2);
        } catch (e) {
            // Content-Type claimed JSON but the body didn't parse - show it raw.
        }
    }

    const headerRows = Object.keys(headers).map(k =>
        '<div class="curl-preview-row"><span class="curl-preview-key">' + escapeHtml(k) +
        '</span><span>' + escapeHtml(headers[k]) + '</span></div>'
    ).join('');

    panel.innerHTML =
        '<div class="curl-status-row">' +
            '<span class="curl-status-badge ' + statusClass(result.status) + '">' +
                escapeHtml(result.status) + ' ' + escapeHtml(result.statusText || '') +
            '</span>' +
            (json ? '<button type="button" class="btn btn-outline-secondary btn-sm" onclick="handleExtractFromCurl()">Extract Keys</button>' : '') +
            '<button type="button" class="btn btn-outline-secondary btn-sm" onclick="handleCopyCurlBody()">Copy body</button>' +
        '</div>' +
        (headerRows ? '<div class="curl-response-headers">' + headerRows + '</div>' : '') +
        (binary ? '<p class="curl-binary-warning">This looks like binary content (' +
            escapeHtml(headerValue(headers, 'content-type') || 'unknown type') +
            '). It was decoded as text below and may be garbled.</p>' : '') +
        '<pre class="curl-response-body">' + escapeHtml(bodyPreview) + '</pre>';
    panel.hidden = false;
}

/* ---------------------------------------------------------------------------
   Actions
--------------------------------------------------------------------------- */

function handleCopyCurlBody() {
    if (!lastCurlResponseBody) {
        showToast('Nothing to copy yet.');
        return;
    }
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(lastCurlResponseBody)
            .then(() => showToast('Copied to clipboard.'))
            .catch(() => showToast('Failed to copy.'));
    } else {
        showToast('Copy is unavailable in this context.');
    }
}

function handleExtractFromCurl() {
    if (!lastCurlResponseBody) {
        return;
    }
    setInputMode('json');
    document.getElementById('textbox1').value = lastCurlResponseBody;
    handleSubmit();
    const target = document.getElementById('request');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function handleCurlExecute() {
    const input = document.getElementById('curlInput').value;
    clearCurlError();
    document.getElementById('curlPreview').hidden = true;
    document.getElementById('curlResponsePanel').hidden = true;

    if (!input.trim()) {
        showCurlError('Paste a curl command first.');
        return;
    }

    let parsed;
    try {
        parsed = window.parseCurlCommand(input);
    } catch (e) {
        showCurlError('Could not parse your curl command: ' + e.message);
        return;
    }

    renderCurlPreview(parsed);

    const button = document.getElementById('curlExecuteBtn');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Executing...';

    try {
        const res = await fetch(CURL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: parsed.url,
                method: parsed.method,
                headers: parsed.headers,
                body: parsed.body
            })
        });
        const json = await res.json();
        if (json.error) {
            showCurlError(CURL_ERROR_MESSAGES[res.status] || json.error);
            return;
        }
        renderCurlResponse(json);
    } catch (e) {
        showCurlError('Could not reach the proxy. Check your connection and try again.');
    } finally {
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const curlInput = document.getElementById('curlInput');
    if (curlInput) {
        curlInput.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleCurlExecute();
            }
        });
    }
});
