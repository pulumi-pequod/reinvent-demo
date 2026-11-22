#!/bin/sh
# Smoke test for a deployed reinvent-tasks stage: the tasks API must answer.
# API_URL is injected by the pipeline from the stack's apiUrl output.
set -eu
echo "smoke: GET ${API_URL}/tasks"
# -f fails on HTTP >= 400; a healthy stage returns a JSON array (often "[]").
body=$(curl -fsS "${API_URL}/tasks")
echo "smoke: response ${body}"
echo "${body}" | grep -q '^\[' || { echo "smoke: expected a JSON array"; exit 1; }
echo "smoke: ok"
