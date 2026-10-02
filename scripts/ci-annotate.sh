#!/usr/bin/env bash
# Turn the tail of a build log into a GitHub annotation.
#
#   scripts/ci-annotate.sh <logfile> "<title>" [lines]
#
# Why this exists: when a packaging step fails, the job's log lives behind a
# signed blob-storage URL. Reading it means opening the run in a browser — so
# the one thing anyone actually needs (the error) is the hardest thing to get,
# and a build that fails for ten seconds tells you nothing at all.
#
# Annotations are different: they come back from the API in a sentence or two,
# so the failure explains itself to a script, to `gh`, and in the run summary.
#
# GitHub workflow commands need their payload escaped, or a log line containing
# a newline, a carriage return or a `%` silently truncates the message:
#   %  → %25      (must be escaped first)
#   \r → %0D
#   \n → %0A
set -uo pipefail

log="${1:?usage: ci-annotate.sh <logfile> <title> [lines]}"
title="${2:-Build failed}"
lines="${3:-40}"

if [ ! -f "$log" ]; then
  echo "::error title=${title}::No log was captured at ${log}."
  exit 0
fi

# The interesting part of a Gradle or electron-builder failure is near the
# bottom; the summary lines are usually within the last screen or two.
#
# Order matters. Carriage returns are dropped first (they are line-ending
# noise, and `tr` is portable, unlike `\r` in a sed pattern — BSD sed on the
# macOS runner treats that as a literal `r` and would mangle every r in the
# message). Then `%` is escaped, and only then are newlines spliced in as
# `%0A`, so the escape sequences this script adds are not escaped again.
tail -n "$lines" "$log" \
  | tr -d '\r' \
  | sed -e 's/%/%25/g' -e ':a' -e 'N' -e '$!ba' -e 's/\n/%0A/g' \
  | sed -e "s/^/::error title=${title}::/"
