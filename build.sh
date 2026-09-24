#!/usr/bin/env bash
# build.sh — regenerate dist/ from content/.
#
# Two modes:
#   full      (default when the Elm toolchain is available) — regenerate
#             design/blog.css from the jmars/blog-design Elm package (the
#             vendor/blog-design submodule; tools/extract-css.mjs keeps the
#             package the single source of truth), then render the pages.
#   fallback  (SKIP_CSS=1, or automatic when elm + happy-dom cannot be
#             found) — skip regeneration and build from the committed
#             design/blog.css.
#
# Hard requirements in BOTH modes: pandoc (or $PANDOC) and node. The full
# mode additionally needs the elm binary and the happy-dom module.
set -euo pipefail
cd "$(dirname "$0")"

# scope boundary first: this repo is the blog only (see README "Scope")
./tools/check-scope.sh

ROOT="$(pwd)"
SITE="$ROOT/../fixpoint-linux/fixpointlinux.org"
PANDOC="${PANDOC:-pandoc}"
CSS="design/blog.css"

command -v "$PANDOC" >/dev/null || { echo "pandoc not found (set PANDOC=...)" >&2; exit 1; }

# elm binary discovery: $ELM, then ./node_modules/.bin/elm, then the sibling
# fixpoint-linux checkout's node_modules (unchanged last fallback).
if [ -n "${ELM:-}" ] && [ -x "${ELM:-}" ]; then
  ELM_BIN="$ELM"
elif [ -x "$ROOT/node_modules/.bin/elm" ]; then
  ELM_BIN="$ROOT/node_modules/.bin/elm"
else
  ELM_BIN="$SITE/node_modules/.bin/elm"
fi

# happy-dom discovery: ./node_modules, else the sibling fixpoint-linux
# node_modules (unchanged last fallback).
if [ -d "$ROOT/node_modules/happy-dom" ]; then
  HAPPYDOM="$ROOT/node_modules/happy-dom"
else
  HAPPYDOM="$SITE/node_modules/happy-dom"
fi

if [ "${SKIP_CSS:-0}" = "1" ]; then
  REGEN=0
  NOTICE="SKIP_CSS=1 — skipping CSS regeneration, using committed $CSS"
elif [ -x "$ELM_BIN" ] && [ -d "$HAPPYDOM" ]; then
  REGEN=1
  NOTICE=""
else
  REGEN=0
  NOTICE="Elm toolchain not found (elm: $ELM_BIN, happy-dom: $HAPPYDOM) — skipping CSS regeneration, using committed $CSS (install elm 0.19.2 + happy-dom to regenerate)"
fi
[ -z "$NOTICE" ] || echo "$(date +%T) notice: $NOTICE"

# Fallback mode still needs a CSS to inline.
if [ "$REGEN" = "0" ] && [ ! -f "$CSS" ]; then
  echo "error: $CSS is missing and the Elm toolchain is unavailable." >&2
  echo "  install elm 0.19.2 + happy-dom (npm i elm@0.19.2 happy-dom) and rerun," >&2
  echo "  or restore the committed copy: git checkout -- $CSS" >&2
  exit 1
fi

if [ "$REGEN" = "1" ]; then
  echo "$(date +%T) [1/2] design CSS from Elm package"
  PREV="$(mktemp)"
  trap 'rm -f "$PREV"' EXIT
  # drift guard: remember the committed CSS so we can warn when a
  # regeneration diverges from what is checked in
  if [ -f "$CSS" ]; then cp "$CSS" "$PREV"; fi
  (cd elm && "$ELM_BIN" make src/ExtractCss.elm --output=ExtractCss.js)
  node tools/extract-css.mjs
  if [ -s "$PREV" ] && ! cmp -s "$PREV" "$CSS"; then
    echo "-----------------------------------------------------------------------"
    echo "WARNING: regenerated $CSS differs from the committed one."
    echo "  The regenerated CSS is now in place — commit it:"
    echo "    git add $CSS"
    echo "-----------------------------------------------------------------------"
  fi
else
  echo "$(date +%T) [1/2] design CSS: committed $CSS (regeneration skipped)"
fi

echo "$(date +%T) [2/2] pages"
PANDOC="$PANDOC" node tools/build.mjs

echo "$(date +%T) build ok"
