#!/usr/bin/env bash
# tools/deploy.sh — publish dist/ to the live host.
#
# WHY THIS SCRIPT EXISTS. The deploy used to be a hand-typed rsync of `dist/`
# with --delete. That is unsafe on this host: the build starts by removing dist/
# (build.mjs `rmSync(DIST, ...)`), and more than one agent can be building at
# once. On 2026-10-02 that race took the site down — a concurrent build wiped
# dist/ in the middle of a transfer, and --delete then removed the remote
# index.html that had not been re-copied yet. The home page served a 404 until a
# fresh build was pushed.
#
# So the tree is FROZEN before it is shipped. rsync reads a directory that
# nothing can mutate, --delete becomes safe again (it can only remove what is
# genuinely gone from the build), and a concurrent builder cannot reach the copy.
#
#   ./tools/deploy.sh              deploy dist/ as it stands
#
# Exit status is rsync's, and the site is verified afterwards.

set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-node-infra}"
DEST="${DEPLOY_DEST:-/srv/www/jaye-ch/}"
BASE="${DEPLOY_URL:-https://blog.jaye.ch}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# A build must exist, and it must be complete: a dist/ without index.html is a
# half-written tree, and deploying it is exactly the outage above.
[ -d dist ] || { echo "deploy: no dist/ — run ./build.sh first" >&2; exit 1; }
[ -f dist/index.html ] || { echo "deploy: dist/index.html is missing — the build is incomplete, refusing" >&2; exit 1; }

# FREEZE. A copy of dist/, taken in one pass, that nothing else writes to.
echo "$(date +%T) freezing dist/ -> $STAGE"
cp -a dist/. "$STAGE/"
for f in index.html 404.html feed.xml sitemap.xml robots.txt; do
  [ -f "$STAGE/$f" ] || { echo "deploy: the frozen copy has no $f — refusing" >&2; exit 1; }
done
echo "$(date +%T) frozen: $(find "$STAGE" -type f | wc -l) file(s), $(du -sh "$STAGE" | cut -f1)"

# SHIP. --delete now reads a tree nothing can mutate, so it can only remove what
# this build genuinely no longer contains.
echo "$(date +%T) rsync -> $HOST:$DEST"
rsync -a --delete --chown=caddy:caddy --rsync-path="sudo rsync" "$STAGE/" "$HOST:$DEST"

# VERIFY. A deploy that is not checked is a deploy that might have 404'd the
# home page — which is how this script came to be written.
echo "$(date +%T) verifying"
fail=0
for path in / /timeline/ /feed.xml /sitemap.xml; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path" || echo 000)"
  printf '  %-16s %s\n' "$path" "$code"
  [ "$code" = "200" ] || fail=1
done
[ "$fail" = "0" ] || { echo "deploy: VERIFY FAILED — the site is not serving; check the host" >&2; exit 1; }
echo "$(date +%T) deploy ok"
