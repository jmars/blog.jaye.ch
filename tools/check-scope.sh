#!/usr/bin/env bash
# check-scope.sh — enforce this repo's scope boundary.
#
# This repo is the BLOG ONLY. The model, the paper, and every experiment live in
# the separate `thing` project (the paper folder) and are referenced from here,
# never copied in. Run by build.sh; also runnable on its own.
#
# Exits non-zero (with a list) if anything that belongs to the paper project —
# or any personal/raw material — is tracked by git or present under content/.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# --- 1. tracked paths that must never exist here -----------------------------
FORBIDDEN_PATHS=(
  'report/' 'staged-report.md' 'practical.md' 'continuity.md'
  'followup-tracker.md' 'architecture.md' 'arch-open-plan.md' 'claim-audit.md'
  'what-held.md' 'dual-control.md' 'survivability.md' 'logical-english.md'
  'dpdr-PLAN.md' 'plan-prompt.md' 'dpdr/' 'dpdr-public/' 'cache/' 'csd/'
  'agent/' 'figures/' 'experiments/' 'currency/'
)
tracked="$(git ls-files)"
bad_paths="$(printf '%s\n' "$tracked" | grep -E "$(IFS='|'; echo "${FORBIDDEN_PATHS[*]}" | sed 's/[.[\*^$]/\\&/g')" || true)"
if [ -n "$bad_paths" ]; then
  echo "SCOPE VIOLATION — paper-project paths are tracked in this blog repo:" >&2
  printf '  %s\n' $bad_paths >&2
  fail=1
fi

# --- 2. forbidden file types / names anywhere tracked ------------------------
bad_types="$(printf '%s\n' "$tracked" | grep -Ei '\.(npz|jsonl|docx|pdf)$|(^|/)paper[^/]*\.md$|exp[0-9]+' || true)"
if [ -n "$bad_types" ]; then
  echo "SCOPE VIOLATION — paper/experiment artifacts are tracked:" >&2
  printf '  %s\n' $bad_types >&2
  fail=1
fi

# --- 3. forbidden strings in tracked text ------------------------------------
# NB: 'DPDR' itself is legitimate (clinical term in the post); the *project
# reference* to `dpdr` is not.
# The guard's own files necessarily mention these patterns, so they are
# excluded from the scan (they are not content).
FORBIDDEN_STRINGS='transcript|[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9Xx]|`dpdr` project|~/thing'
bad_str="$(git grep -nIE "$FORBIDDEN_STRINGS" -- . \
  ':!tools/check-scope.sh' ':!.gitignore' ':!README.md' 2>/dev/null || true)"
if [ -n "$bad_str" ]; then
  echo "SCOPE VIOLATION — forbidden strings found:" >&2
  printf '  %s\n' "$bad_str" >&2
  fail=1
fi

# --- 4. content/ shape --------------------------------------------------------
# The blog's own words only: the expected posts (in nav order per posts.json),
# nothing else.
unexpected="$(find content -type f 2>/dev/null | sort | grep -vE '^content/(meditation-harm|meditation-harm-summary|anxiety-damping|what-actually-works|recovery-is-not-immunity|manufacturing-the-collapse|sacred-science|empty-leader|safeguards|the-label)\.md$' || true)"
if [ -n "$unexpected" ]; then
  echo "SCOPE VIOLATION — unexpected files under content/:" >&2
  printf '  %s\n' $unexpected >&2
  fail=1
fi

if [ "$fail" = "0" ]; then
  echo "scope ok — blog-only (paper/model/experiments stay in the 'thing' project)"
fi
exit "$fail"
