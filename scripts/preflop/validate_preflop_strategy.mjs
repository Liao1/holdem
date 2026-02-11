#!/usr/bin/env node
import fs from 'node:fs';

const input = process.argv[2] || 'src/engine/gto/strategies/preflop-100bb-gto.json';
const raw = fs.readFileSync(input, 'utf8');
const data = JSON.parse(raw);

const errors = [];
const warnings = [];

if (!Array.isArray(data.spots) || data.spots.length === 0) {
  errors.push('spots must be a non-empty array');
}

const handKeyRe = /^[AKQJT98765432]{2}(s|o)?$/;

for (const spot of data.spots || []) {
  if (!spot.id) errors.push('spot missing id');
  if (!spot.scenario) errors.push(`spot ${spot.id || '?'} missing scenario`);
  if (!spot.heroPosition) errors.push(`spot ${spot.id || '?'} missing heroPosition`);

  const hands = spot.hands || {};
  const keys = Object.keys(hands);
  if (keys.length !== 169) {
    warnings.push(`spot ${spot.id}: expected 169 hands, got ${keys.length}`);
  }

  for (const key of keys) {
    if (!handKeyRe.test(key)) {
      errors.push(`spot ${spot.id}: invalid hand key ${key}`);
      continue;
    }

    const a = hands[key];
    for (const field of ['fold', 'call', 'raise', 'allIn']) {
      if (typeof a[field] !== 'number') {
        errors.push(`spot ${spot.id}:${key} missing numeric ${field}`);
      }
    }

    const total = a.fold + a.call + a.raise + a.allIn;
    if (Math.abs(total - 1) > 1e-6) {
      errors.push(`spot ${spot.id}:${key} probabilities do not sum to 1 (${total})`);
    }
  }
}

if (warnings.length > 0) {
  console.log('[validate] warnings:');
  for (const w of warnings) console.log(`  - ${w}`);
}

if (errors.length > 0) {
  console.error('[validate] errors:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`[validate] ok: ${data.spots.length} spots validated`);
