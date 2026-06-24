#!/bin/bash
# Replaces em dashes (—) with hyphens (-) in HTML files.
# Usage:
#   ./replace-emdash.sh              # all .html files in the project
#   ./replace-emdash.sh about.html   # specific file

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -n "$1" ]; then
    files=("$1")
else
    mapfile -t files < <(find "$SCRIPT_DIR" -name "*.html" -not -path "*/.git/*")
fi

for file in "${files[@]}"; do
    if grep -q "—" "$file"; then
        sed -i 's/—/-/g' "$file"
        echo "Updated: $file"
    else
        echo "No change: $file"
    fi
done
