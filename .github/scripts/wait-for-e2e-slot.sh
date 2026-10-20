#!/usr/bin/env bash
# Only one E2E run may drive the Discord bot at a time. GitHub's `concurrency`
# cancels every pending run but one instead of queueing them, so this script
# queues by hand: it blocks until no older run of this workflow still has its
# Discord job pending or running. Older runs always go first, so the queue
# cannot deadlock. Needs `actions: read` on GH_TOKEN.
set -euo pipefail

workflow_file="${WORKFLOW_FILE:-e2e.yml}"
job_name="${JOB_NAME:-e2e}"
poll_seconds="${POLL_SECONDS:-20}"

older_active_runs() {
  gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_file}/runs?per_page=50" \
    --jq ".workflow_runs[]
          | select(.id < ${GITHUB_RUN_ID})
          | select(.status | IN(\"queued\", \"waiting\", \"pending\", \"requested\", \"in_progress\"))
          | \"\(.id) \(.status)\""
}

job_unfinished_in_run() {
  local run_id="$1"
  local unfinished
  unfinished=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/jobs?per_page=100" \
    --jq "[.jobs[] | select(.name == \"${job_name}\" and .status != \"completed\")] | length")
  [ "${unfinished}" -gt 0 ]
}

blocking_runs() {
  while read -r run_id status; do
    [ -z "${run_id}" ] && continue
    if [ "${status}" != "in_progress" ] || job_unfinished_in_run "${run_id}"; then
      echo "${run_id} (${status})"
    fi
  done < <(older_active_runs)
}

while true; do
  blocking=$(blocking_runs)
  if [ -z "${blocking}" ]; then
    echo "No older ${workflow_file} run is using the Discord bot, continuing."
    exit 0
  fi
  echo "Waiting for older ${workflow_file} run(s) to release the Discord bot:"
  echo "${blocking}" | sed 's/^/  /'
  sleep "${poll_seconds}"
done
