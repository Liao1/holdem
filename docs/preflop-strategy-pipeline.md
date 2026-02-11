# Preflop Strategy Pipeline

This project now loads preflop strategy from JSON:

- `src/engine/gto/strategies/preflop-100bb-gto.json`

The file is extracted from:

- `docs/100bb-gto-charts.pdf`

## One-command extraction

```bash
npm run extract:preflop
```

This runs:

1. `scripts/preflop/extract_preflop_strategy.swift`
2. `scripts/preflop/validate_preflop_strategy.mjs`

## Extraction details

- The extractor renders each PDF page with PDFKit (no external OCR or Python deps).
- Each chart grid cell is sampled by color.
- Color mapping:
  - Red/Blue -> raise (3-bet/4-bet bucket)
  - Green -> call/limp
  - Dark gray/White -> fold
- Hand granularity is 169 buckets (`AA`, `AKs`, `AKo`, ...).

## Important assumptions

- Chart format is fixed to this exact PDF layout (14 pages, known chart coordinates).
- Stack depth is 100bb.
- If color classification cannot confidently identify an action, strategy defaults to fold in runtime fallback.

## Runtime usage

- Loader: `src/engine/gto/strategy-loader.ts`
- Types: `src/engine/gto/strategy-types.ts`
- Preflop engine integration: `src/engine/gto/preflop-engine.ts`

When a spot is missing in JSON, runtime logs a warning and falls back to legacy hardcoded preflop ranges.
