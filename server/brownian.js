"use strict";

// The finite-horizon Brownian first-passage formula, shared by the bankroll
// simulation (as its analytical benchmark) and the posterior bankroll
// calculation (as its risk function). The normal-distribution helpers live in
// standalone/shared/stats.js, which the page uses too.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const { logErfc, logPhi, phi, normalQuantile } = require("../standalone/shared/stats.js");

// Finite-horizon first-passage probability for Brownian motion with drift.
// The reflection term exp(-2 mu b / sigma^2) overflows for negative drift and
// large bankrolls while its partner Phi(...) underflows, so both are combined
// in log space (as src/validation.py does with scipy's log_ndtr).
function brownFinite(winRate, standardDeviation, bankroll, threshold, hands) {
  const distance = bankroll - threshold;
  if (distance <= 0) return 1;
  const drift = winRate / 100;
  const variance = (standardDeviation * standardDeviation) / 100;
  if (variance <= 0) return distance + drift * hands <= 0 ? 1 : 0;
  const denominator = Math.sqrt(variance * hands);
  const first = (-distance - drift * hands) / denominator;
  const second = (-distance + drift * hands) / denominator;
  const logReflection = (-2 * drift * distance) / variance + logPhi(second);
  const probability = Math.exp(logPhi(first)) + Math.exp(logReflection);
  return clamp(probability, 0, 1);
}

module.exports = { logErfc, logPhi, phi, normalQuantile, brownFinite };
