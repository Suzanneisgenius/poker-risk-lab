"use strict";

const {
  equityMultiwayMC,
  equityExact,
  nRunouts,
} = require("../standalone/engines/equity.js");
const { trainKuhnTracked, averageGameValue } = require("../standalone/engines/cfr.js");
const { getPreflopDataset } = require("./preflop.js");
const { ValidationError } = require("./errors.js");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Work ceilings sized so the largest accepted request finishes well inside the
// route timeouts on a small shared CPU. One "path-step" advances one bankroll
// path by one 100-hand increment.
//
// Equity needs no separate ceiling: the evaluator ranks ~10M hands/s, and the
// largest accepted request (exact heads-up preflop, 1,712,304 runouts, i.e.
// ~3.4M evaluations) takes well under a second.
const MAX_PATH_STEPS = 100000000;
const CURVE_POINTS = 9;

function number(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${label} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function integer(value, label, min, max) {
  return Math.round(number(value, label, min, max));
}

function cards(value, label, minLength, maxLength) {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    throw new ValidationError(`${label} has an invalid number of cards.`);
  }
  return value.map((card) => integer(card, `${label} card`, 0, 51));
}

function validateKnownCards(hero, opponents, board) {
  const known = [...hero, ...board, ...opponents.filter(Boolean).flat()];
  if (new Set(known).size !== known.length) throw new ValidationError("The same card cannot be used twice.");
}

// Validate an equity request and decide how it will be computed, without
// running it. Shared by computeEquity and estimateCost so the rate-limit charge
// always matches the work actually done.
function planEquity(input) {
  const hero = cards(input.hero, "Your hand", 2, 2);
  const board = cards(input.board || [], "Board", 0, 5);
  if (!Array.isArray(input.opponents) || input.opponents.length < 1 || input.opponents.length > 5) {
    throw new ValidationError("Choose between one and five opponents.");
  }
  const opponents = input.opponents.map((hand, index) =>
    hand === null ? null : cards(hand, `Opponent ${index + 1}`, 2, 2)
  );
  validateKnownCards(hero, opponents, board);
  const trials = integer(input.trials ?? 30000, "Trials", 1000, 150000);
  const seed = integer(input.seed ?? 42, "Seed", -2147483648, 2147483647);
  const players = opponents.length + 1;

  // Every fixed heads-up spot is enumerated exactly, preflop included.
  if (opponents.length === 1 && opponents[0]) {
    const runs = nRunouts(hero, opponents[0], board);
    return { mode: "exact", hero, board, opponents, seed, trials: runs, evaluations: runs * 2 };
  }
  if (board.length === 5 && opponents.every(Boolean)) {
    return { mode: "showdown", hero, board, opponents, seed, trials: 1, evaluations: players };
  }
  // Every multiway trial ranks one hand per player.
  return { mode: "multiway", hero, board, opponents, seed, trials, evaluations: trials * players };
}

function computeEquity(input) {
  const plan = planEquity(input);
  const { hero, board, opponents, seed, trials } = plan;
  const trialText = trials.toLocaleString("en-US");
  switch (plan.mode) {
    case "exact":
      return {
        result: equityExact(hero, opponents[0], board),
        methodText: `Exact enumeration over ${trialText} runouts.`,
      };
    case "showdown":
      return {
        result: { ...equityMultiwayMC(hero, opponents, board, 1, seed), method: "exact" },
        methodText: `Exact showdown against ${opponents.length} opponents.`,
      };
    default:
      return {
        result: equityMultiwayMC(hero, opponents, board, trials, seed),
        methodText: `Multiway Monte Carlo against ${opponents.length} opponent${opponents.length === 1 ? "" : "s"}, ${trialText} trials.`,
      };
  }
}

function computeEv(input) {
  const pot = number(input.pot, "Pot", 0, 1000000000);
  const call = number(input.call, "Call amount", 0.000001, 1000000000);
  const equityPct = number(input.equityPct, "Equity", 0, 100);
  const equity = equityPct / 100;
  const potOdds = call / (pot + call);
  const evCall = equity * pot - (1 - equity) * call;
  return { pot, call, equity, potOdds, requiredEquity: potOdds, evCall, profitable: equity >= potOdds };
}

function mulberry32(seed) {
  let value = seed | 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFactory(seed) {
  const random = mulberry32(seed >>> 0);
  let spare = null;
  return function gaussian() {
    if (spare !== null) {
      const saved = spare;
      spare = null;
      return saved;
    }
    let u = 0;
    while (u <= 1e-12) u = random();
    const v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

// log(erfc(z)) for z >= 0. Chebyshev fit from Numerical Recipes (erfcc), with
// fractional error below 1.2e-7 everywhere. Staying in log space means it never
// underflows, however far into the tail z is.
function logErfc(z) {
  const t = 1 / (1 + 0.5 * z);
  return Math.log(t) - z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277))))))));
}

// log of the standard normal CDF, accurate in both tails.
function logPhi(x) {
  const z = -x / Math.SQRT2;
  if (z >= 0) return Math.log(0.5) + logErfc(z);
  return Math.log1p(-0.5 * Math.exp(logErfc(-z)));
}

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

function simulateBankroll(params, pathCount, storeCount) {
  const steps = Math.ceil(params.hands / params.step);
  const finalStep = params.hands - (steps - 1) * params.step;
  const regularDrift = (params.wr * params.step) / 100;
  const regularSwing = params.sd * Math.sqrt(params.step / 100);
  const finalDrift = (params.wr * finalStep) / 100;
  const finalSwing = params.sd * Math.sqrt(finalStep / 100);
  const gaussian = gaussFactory(params.seed);
  const terminals = new Float64Array(pathCount);
  const drawdowns = new Float64Array(pathCount);
  const plotStep = Math.max(1, Math.floor(steps / 100));
  const xs = [0];
  for (let step = 1; step <= steps; step += 1) {
    if (step % plotStep === 0 || step === steps) xs.push(Math.min(step * params.step, params.hands));
  }
  const paths = [];
  const ruinFlags = [];
  let ruinedCount = 0;
  let profitCount = 0;
  for (let index = 0; index < pathCount; index += 1) {
    let bankroll = params.bank;
    let peak = params.bank;
    let maxDrawdown = 0;
    let ruined = false;
    const keep = index < storeCount;
    const line = keep ? [params.bank] : null;
    for (let step = 1; step <= steps; step += 1) {
      if (!ruined) {
        const isFinalStep = step === steps;
        bankroll += (isFinalStep ? finalDrift : regularDrift) + (isFinalStep ? finalSwing : regularSwing) * gaussian();
        if (bankroll <= params.thr) {
          bankroll = params.thr;
          ruined = true;
        }
        if (bankroll > peak) peak = bankroll;
        const drawdown = peak - bankroll;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        // Non-visual paths need no plateau points after absorption. Leaving the
        // loop here preserves the exact result and avoids thousands of empty
        // iterations in high-risk scenarios.
        if (ruined && !keep) break;
      }
      if (keep && (step % plotStep === 0 || step === steps)) line.push(bankroll);
    }
    terminals[index] = bankroll;
    drawdowns[index] = maxDrawdown;
    if (ruined) ruinedCount += 1;
    if (bankroll > params.bank) profitCount += 1;
    if (keep) {
      paths.push(line);
      ruinFlags.push(ruined);
    }
  }
  return { pathCount, ruinedCount, profitCount, terminals, drawdowns, xs, paths, ruinFlags };
}

function percentile(values, quantile) {
  const sorted = Float64Array.from(values).sort();
  const index = (sorted.length - 1) * quantile;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function bands(paths, divisor) {
  if (!paths.length) return { p05: [], p25: [], p50: [], p75: [], p95: [] };
  const output = { p05: [], p25: [], p50: [], p75: [], p95: [] };
  for (let column = 0; column < paths[0].length; column += 1) {
    const values = paths.map((path) => path[column] / divisor);
    output.p05.push(percentile(values, 0.05));
    output.p25.push(percentile(values, 0.25));
    output.p50.push(percentile(values, 0.5));
    output.p75.push(percentile(values, 0.75));
    output.p95.push(percentile(values, 0.95));
  }
  return output;
}

function curvePathsPerPoint(params) {
  return clamp(Math.round(params.paths * 0.1), 200, 500);
}

// Total path-steps a bankroll request simulates: the main fan plus, when
// requested, the nine smaller runs behind the risk-versus-bankroll curve.
function simulationPathSteps(params, includeCurve) {
  const steps = Math.ceil(params.hands / params.step);
  return steps * (params.paths + (includeCurve ? CURVE_POINTS * curvePathsPerPoint(params) : 0));
}

function normalizeBankroll(input, maxPaths, includeCurve) {
  const params = {
    wr: number(input.wr, "Win rate", -100, 100),
    sd: number(input.sd, "Standard deviation", 0, 500),
    bank: number(input.bank, "Bankroll", 0, 1000000),
    thr: number(input.thr ?? 0, "Ruin threshold", 0, 1000000),
    hands: integer(input.hands, "Hands", 100, 1000000),
    paths: integer(input.paths, "Paths", 100, maxPaths),
    step: 100,
    seed: integer(input.seed ?? 42, "Seed", -2147483648, 2147483647),
  };
  if (params.bank <= params.thr) throw new ValidationError("Bankroll must be above the ruin threshold.");
  if (simulationPathSteps(params, includeCurve) > MAX_PATH_STEPS) {
    throw new ValidationError("Paths × hands is too large for one request. Choose fewer simulation paths or fewer hands.");
  }
  return params;
}

function riskCurve(params, divisor) {
  const low = Math.max(params.thr + divisor, params.bank * 0.3);
  // The fan chart uses the full requested budget. The secondary comparison
  // curve only needs enough samples to show direction alongside its smooth
  // analytical benchmark; capping it prevents nine hidden full simulations.
  const pathsPerPoint = curvePathsPerPoint(params);
  const xs = [];
  const monteCarlo = [];
  const analytical = [];
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    const bank = low + ((params.bank * 2 - low) * index) / (CURVE_POINTS - 1);
    const scenario = { ...params, bank, seed: params.seed + index * 7919 };
    const simulation = simulateBankroll(scenario, pathsPerPoint, 0);
    xs.push(bank / divisor);
    monteCarlo.push(simulation.ruinedCount / simulation.pathCount);
    analytical.push(brownFinite(params.wr, params.sd, bank, params.thr, params.hands));
  }
  return { xs, monteCarlo, analytical, pathsPerPoint };
}

function computeBankroll(input) {
  const params = normalizeBankroll(input, 20000, true);
  const divisor = 100;
  const simulation = simulateBankroll(params, params.paths, Math.min(100, params.paths));
  const risk = simulation.ruinedCount / simulation.pathCount;
  return {
    params,
    metrics: {
      risk,
      p95Drawdown: percentile(simulation.drawdowns, 0.95) / divisor,
      medianTerminal: percentile(simulation.terminals, 0.5) / divisor,
      profitProbability: simulation.profitCount / simulation.pathCount,
      brownian: brownFinite(params.wr, params.sd, params.bank, params.thr, params.hands),
    },
    fan: {
      xs: simulation.xs,
      paths: simulation.paths.map((path) => path.map((value) => value / divisor)),
      ruinFlags: simulation.ruinFlags,
      ...bands(simulation.paths, divisor),
    },
    curve: riskCurve(params, divisor),
  };
}

function wilsonInterval(successes, total) {
  const z = 1.96;
  const probability = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (probability + (z * z) / (2 * total)) / denominator;
  const half = (z * Math.sqrt((probability * (1 - probability)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function normalizeRiskLab(input) {
  return normalizeBankroll({ ...input, thr: 0 }, 40000, input.includeCurve !== false);
}

function computeRiskLab(input) {
  const params = normalizeRiskLab(input);
  const divisor = 100;
  const simulation = simulateBankroll(params, params.paths, Math.min(80, params.paths));
  const risk = simulation.ruinedCount / simulation.pathCount;
  return {
    params,
    metrics: {
      risk,
      confidenceInterval: wilsonInterval(simulation.ruinedCount, simulation.pathCount),
      survival: 1 - risk,
      p95Drawdown: percentile(simulation.drawdowns, 0.95) / divisor,
    },
    fan: {
      xs: simulation.xs,
      paths: simulation.paths.map((path) => path.map((value) => value / divisor)),
      ruinFlags: simulation.ruinFlags,
      ...bands(simulation.paths, divisor),
    },
    curve: input.includeCurve === false ? null : riskCurve(params, divisor),
  };
}

function gtoIterations(input) {
  return integer(input.iterations ?? 300000, "Iterations", 10000, 500000);
}

function computeGto(input) {
  const iterations = gtoIterations(input);
  const seed = integer(input.seed ?? 42, "Seed", -2147483648, 2147483647);
  const trained = trainKuhnTracked(iterations, 50, seed);
  const value = averageGameValue(trained.nodes);
  const strategy = trained.strategy;
  const betJ = strategy.J ? strategy.J[1] : 0;
  const betK = strategy.K ? strategy.K[1] : 0;
  return {
    iterations,
    seed,
    value,
    error: Math.abs(value + 1 / 18),
    strategy,
    history: trained.history,
    checks: {
      kingJackRatio: betJ > 1e-3 ? betK / betJ : null,
      queenOpenBet: strategy.Q ? strategy.Q[1] : 0,
    },
  };
}

function computePreflop(input) {
  const scenarioId = typeof input.scenarioId === "string" ? input.scenarioId : undefined;
  return getPreflopDataset(scenarioId);
}

const isObject = (input) => Boolean(input) && typeof input === "object" && !Array.isArray(input);

// Rate-limit points for one request, proportional to the work compute() will
// do for it. Roughly one point per 1M hand evaluations, 2.5M bankroll
// path-steps, or 50k CFR iterations. Invalid input costs the minimum because
// compute() rejects it before doing any work.
function estimateCost(type, input) {
  if (!isObject(input)) return 1;
  try {
    switch (type) {
      case "equity": return 1 + Math.ceil(planEquity(input).evaluations / 1000000);
      case "bankroll": return 2 + Math.ceil(simulationPathSteps(normalizeBankroll(input, 20000, true), true) / 2500000);
      case "risk-lab": return 2 + Math.ceil(simulationPathSteps(normalizeRiskLab(input), input.includeCurve !== false) / 2500000);
      case "gto": return 2 + Math.ceil(gtoIterations(input) / 50000);
      default: return 1;
    }
  } catch (error) {
    if (error instanceof ValidationError) return 1;
    throw error;
  }
}

function compute(type, input) {
  if (!isObject(input)) throw new ValidationError("Request body must be a JSON object.");
  switch (type) {
    case "equity": return computeEquity(input);
    case "ev": return computeEv(input);
    case "bankroll": return computeBankroll(input);
    case "risk-lab": return computeRiskLab(input);
    case "preflop": return computePreflop(input);
    case "gto": return computeGto(input);
    default: throw new ValidationError("Unknown calculation type.");
  }
}

module.exports = {
  compute,
  computeEquity,
  computeEv,
  computeBankroll,
  computeRiskLab,
  computePreflop,
  computeGto,
  estimateCost,
  simulationPathSteps,
  brownFinite,
  logPhi,
  MAX_PATH_STEPS,
};
