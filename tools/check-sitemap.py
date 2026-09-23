#!/usr/bin/env python3
"""Compare each sitemap lastmod against the file's last commit date.

A page that changed only in metadata or navigation chrome should keep its old
lastmod: inflating it for trivial edits teaches search engines to distrust the
signal. So this reports rather than rewrites, and the call stays a judgement.

    python3 tools/check-sitemap.py
"""
import os
import subprocess
import sys
import xml.etree.ElementTree as ET

NS = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
BASE = 'https://jsonkeyper.com/'


def local_path(loc):
    path = loc.replace(BASE, '') or 'index.html'
    return path + 'index.html' if path.endswith('/') else path


def main():
    root = ET.parse('sitemap.xml').getroot()
    stale, missing = [], []
    for url in root.findall(NS + 'url'):
        loc = url.find(NS + 'loc').text
        node = url.find(NS + 'lastmod')
        path = local_path(loc)
        if not os.path.exists(path):
            missing.append(loc)
            continue
        committed = subprocess.run(
            ['git', 'log', '-1', '--format=%cs', '--', path],
            capture_output=True, text=True).stdout.strip()
        listed = node.text if node is not None else ''
        if committed and committed > listed:
            stale.append((path, listed, committed))

    for loc in missing:
        print('missing file for %s' % loc)
    for path, listed, committed in stale:
        print('%-46s sitemap %s, last commit %s' % (path, listed, committed))

    # Any page in the repo that the sitemap never mentions.
    listed_paths = {local_path(u.find(NS + 'loc').text) for u in root.findall(NS + 'url')}
    for dirpath, _, names in os.walk('.'):
        if any(part in dirpath for part in ('./.git', './tools', './node_modules')):
            continue
        for name in names:
            if not name.endswith('.html') or name == '404.html':
                continue
            rel = os.path.normpath(os.path.join(dirpath, name))
            if rel not in listed_paths:
                print('not in sitemap: %s' % rel)

    if missing:
        return 1
    print('\n%d newer than their lastmod, %d urls checked.'
          % (len(stale), len(root.findall(NS + 'url'))))
    print('Update only those whose visible content actually changed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
