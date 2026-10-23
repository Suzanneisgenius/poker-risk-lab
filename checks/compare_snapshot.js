"use strict";

const assert = require("node:assert/strict");

// Math functions can differ in their last bits across runtimes/architectures.
// This is a roundoff allowance, not the looser Python/model-agreement tolerance.
const ABS_TOLERANCE = 1e-12;
const REL_TOLERANCE = 1e-12;

function compareSnapshot(actual, expected) {
  const differences = [];
  let rounded = 0;
  let largest = null;
  function visit(a, e, at, exact = false) {
    if (typeof a === "number" && typeof e === "number") {
      if (!Number.isFinite(a) || !Number.isFinite(e)) {
        differences.push(`${at}: non-finite number (saved ${e}, current ${a})`);
      } else if (a !== e) {
        const delta = Math.abs(a - e);
        const limit = ABS_TOLERANCE + REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(e));
        // Inputs and integer values (counts, seeds, sample sizes) stay exact.
        if (exact || Number.isInteger(a) || Number.isInteger(e) || delta > limit) {
          differences.push(`${at}: saved ${e}, current ${a}, |difference| ${delta}, tolerance ${exact || Number.isInteger(a) || Number.isInteger(e) ? 0 : limit}`);
        } else {
          rounded += 1;
          if (!largest || delta / limit > largest.fraction) largest = { at, saved: e, current: a, delta, limit, fraction: delta / limit };
        }
      }
      return;
    }
    if (a === null || e === null || typeof a !== "object" || typeof e !== "object") {
      if (a !== e) differences.push(`${at}: saved ${JSON.stringify(e)}, current ${JSON.stringify(a)}`);
      return;
    }
    if (Array.isArray(a) !== Array.isArray(e)) {
      differences.push(`${at}: array/object type changed`);
      return;
    }
    if (Array.isArray(a) && a.length !== e.length) differences.push(`${at}: saved length ${e.length}, current length ${a.length}`);
    for (const key of new Set([...Object.keys(e), ...Object.keys(a)])) {
      const next = Array.isArray(e) ? `${at}[${key}]` : `${at}.${key}`;
      if (!Object.hasOwn(a, key) || !Object.hasOwn(e, key)) {
        differences.push(`${next}: ${Object.hasOwn(e, key) ? "missing" : "unexpected"} field`);
      } else visit(a[key], e[key], next, exact || key === "input" || key === "inputs");
    }
  }
  visit(actual, expected, "$");
  return { differences, rounded, largest };
}

function assertSnapshot(actual, expected, label) {
  const result = compareSnapshot(actual, expected);
  assert.equal(result.differences.length, 0, `${label}: ${result.differences.length} differences.\n${result.differences.slice(0, 20).join("\n")}`);
  if (result.rounded) {
    const r = result.largest;
    console.log(`${label}: ${result.rounded} values differ only within roundoff tolerance; largest relative to its limit: ${r.at}, saved ${r.saved}, current ${r.current}, |difference| ${r.delta}, tolerance ${r.limit}.`);
  }
  return result;
}

module.exports = { compareSnapshot, assertSnapshot };
