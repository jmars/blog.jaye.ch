#!/usr/bin/env bash
# check-scope.sh — enforce this repo's scope boundary.
#
# This repo is the BLOG ONLY. The model, the paper, and every experiment live in
# a separate paper project and are referenced from here, never copied in. Run by
# build.sh; also runnable on its own.
#
# Exits non-zero (with a list) if anything that belongs to that project — or any
# personal/raw material — is tracked by git or present under content/.
#
# The checks here are deliberately GENERIC (artifact types, a couple of string
# patterns, the shape of content/). The project-specific names live in a local,
# untracked file (`.scope-local`) which is sourced if present, so this script can
# be published without listing another project's private filenames.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# --- 0. local, unpublished rules (optional) ----------------------------------
LOCAL_RULES="$(cd "$(dirname "$0")/.." && pwd)/.scope-local"
SCOPE_LOCAL_PATHS=()
SCOPE_LOCAL_STRINGS=''
if [ -f "$LOCAL_RULES" ]; then
  # shellcheck disable=SC1090
  . "$LOCAL_RULES"
fi

# --- 1. tracked paths that must never exist here -----------------------------
if [ "${#SCOPE_LOCAL_PATHS[@]}" -gt 0 ]; then
  tracked="$(git ls-files)"
  esc="$(IFS='|'; echo "${SCOPE_LOCAL_PATHS[*]}" | sed 's/[.[\*^$]/\\&/g')"
  bad_paths="$(printf '%s\n' "$tracked" | grep -E "$esc" || true)"
  if [ -n "$bad_paths" ]; then
    echo "SCOPE VIOLATION — paper-project paths are tracked in this blog repo:" >&2
    printf '  %s\n' $bad_paths >&2
    fail=1
  fi
else
  echo "scope note: no local rules found (.scope-local absent) — path checks skipped" >&2
fi

# --- 2. forbidden file types / names anywhere tracked ------------------------
# Generic: binary result dumps, generated documents, and numbered experiment
# outputs have no business in a blog repo regardless of where they came from.
tracked="${tracked:-$(git ls-files)}"
bad_types="$(printf '%s\n' "$tracked" | grep -Ei '\.(npz|jsonl|docx)$|(^|/)paper[^/]*\.md$|exp[0-9]+' || true)"
if [ -n "$bad_types" ]; then
  echo "SCOPE VIOLATION — artifact files are tracked in this blog repo:" >&2
  printf '  %s\n' $bad_types >&2
  fail=1
fi

# --- 3. forbidden strings in tracked text ------------------------------------
# Generic patterns only: a raw transcript reference, or an ORCID-style
# identifier. Project-specific strings come from `.scope-local`. The guard's own
# files necessarily mention these patterns, so they are excluded from the scan.
FORBIDDEN_STRINGS='transcript|[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9Xx]'
if [ -n "$SCOPE_LOCAL_STRINGS" ]; then
  FORBIDDEN_STRINGS="$FORBIDDEN_STRINGS|$SCOPE_LOCAL_STRINGS"
fi
bad_str="$(git grep -nIE "$FORBIDDEN_STRINGS" -- . \
  ':!tools/check-scope.sh' ':!.gitignore' ':!.scope-local' ':!README.md' 2>/dev/null || true)"
if [ -n "$bad_str" ]; then
  echo "SCOPE VIOLATION — forbidden strings found:" >&2
  printf '  %s\n' "$bad_str" >&2
  fail=1
fi

# --- 4. content/ shape --------------------------------------------------------
# The blog's own words only: exactly the files the manifest lists as posts, plus
# the home file. Derived from posts.json, so it stays in step as posts change.
expected="$(node -e '
  const m = require("./posts.json");
  const f = [m.home.file, ...m.posts.map((p) => p.file)];
  process.stdout.write(f.map((x) => "content/" + x).join("\n") + "\n");
')"
actual="$(find content -type f 2>/dev/null)"
# order-independent set difference (no reliance on collation)
unexpected="$(printf '%s\n' "$actual" | grep -vxF -f <(printf '%s\n' "$expected") || true)"
missing="$(printf '%s\n' "$expected" | grep -vxF -f <(printf '%s\n' "$actual") || true)"
if [ -n "$unexpected" ]; then
  echo "SCOPE VIOLATION — unexpected files under content/:" >&2
  printf '  %s\n' $unexpected >&2
  fail=1
fi
if [ -n "$missing" ]; then
  echo "SCOPE VIOLATION — files listed in posts.json are missing from content/:" >&2
  printf '  %s\n' $missing >&2
  fail=1
fi

if [ "$fail" = "0" ]; then
  echo "scope ok — blog-only"
fi
exit "$fail"
