#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
run_dir=$(mktemp -d './run_XXXXXXXX')
python -m unittest -v
python experiments.py --out "$run_dir/experiments"
python stress.py --out "$run_dir/stress-results"
printf 'Results saved in %s\n' "$run_dir"
