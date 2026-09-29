#!/usr/bin/env python3
"""Serve the site locally the way GitHub Pages resolves URLs.

Internal links are extensionless (/about, /blog/cors-explained), which a plain
`python3 -m http.server` cannot resolve. This server maps /about to about.html,
redirects /blog to /blog/, and serves 404.html for unknown paths.

    python3 tools/serve.py          # http://localhost:8000
    python3 tools/serve.py 9000     # another port
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_head(self):
        path = self.path.split('?')[0].split('#')[0]
        target = os.path.join(ROOT, path.lstrip('/'))
        if os.path.isdir(target) and not path.endswith('/'):
            self.send_response(301)
            self.send_header('Location', path + '/')
            self.end_headers()
            return None
        if not os.path.exists(target):
            if not os.path.exists(target + '.html'):
                return self.send_not_found()
            self.path = path + '.html'
        return super().send_head()

    def send_not_found(self):
        page = open(os.path.join(ROOT, '404.html'), 'rb')
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(os.fstat(page.fileno()).st_size))
        self.end_headers()
        return page


if __name__ == '__main__':
    print(f'Serving {ROOT} at http://localhost:{PORT}')
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
