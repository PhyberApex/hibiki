#!/usr/bin/env bash
# Appends the Code signing policy (.github/release-notes/code-signing-policy.md)
# to a GitHub Release's notes, below the changelog release-please wrote.
# SignPath Foundation requires the policy on the release page as well as the
# README (ADR-0008). Idempotent: a release that already carries the section is
# left alone, so re-running the workflow does not duplicate it.
# Needs `contents: write` on GH_TOKEN.
set -euo pipefail

tag="${1:?usage: append-release-policy.sh <tag>}"
policy_file="${POLICY_FILE:-.github/release-notes/code-signing-policy.md}"
heading="$(head -n 1 "$policy_file")"

body="$(gh release view "$tag" --json body --jq .body)"

if grep -qxF "$heading" <<<"$body"; then
  echo "Release ${tag} already carries the Code signing policy; nothing to do."
  exit 0
fi

notes="$(mktemp)"
trap 'rm -f "$notes"' EXIT
printf '%s\n\n' "$body" >"$notes"
cat "$policy_file" >>"$notes"

gh release edit "$tag" --notes-file "$notes"
echo "Appended the Code signing policy to release ${tag}."
