#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:-docs/100bb-gto-charts.pdf}"
OUTPUT="${2:-src/engine/gto/strategies/preflop-100bb-gto.json}"

mkdir -p /tmp/fakehome/.cache/clang/ModuleCache
HOME=/tmp/fakehome swift scripts/preflop/extract_preflop_strategy.swift --input "$INPUT" --output "$OUTPUT"
node scripts/preflop/validate_preflop_strategy.mjs "$OUTPUT"
