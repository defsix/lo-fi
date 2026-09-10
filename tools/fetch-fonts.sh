#!/bin/sh
# Refetch the self-hosted fonts from Google Fonts and regenerate fonts.css.
#
# The site does not link to fonts.googleapis.com at runtime — that request
# sent every visitor's IP to a third party before a note was played. This
# fetches the same files once, at development time, so they can be served
# from our own origin. Run when a font or weight changes.
#
#   sh tools/fetch-fonts.sh
#
# Both families are SIL Open Font License 1.1, which permits this and
# requires OFL.txt to travel with them. Do not delete it.
set -e
cd "$(dirname "$0")/.."
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
URL='https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap'
curl -sS -A "$UA" "$URL" -o fonts/google.css
node tools/build-fonts.mjs
rm -f fonts/google.css
echo "fonts refreshed — check fonts/fonts.css and commit the woff2 files"
