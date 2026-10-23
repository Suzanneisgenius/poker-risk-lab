"use strict";

// Bankroll risk from a player's own results.
//
// The true win rate mu (bb/100) is unknown. Results so far give an observed net
// win rate over N hands. With the volatility sigma (bb/100) held fixed, the
// observed rate is Normal(mu, se^2) with se = sigma / sqrt(N / 100), and a
// Normal prior (or none) gives a Normal posterior for mu.
//
// "Model risk" R(mu) is the finite-horizon Brownian first-passage probability
// of falling from the bankroll to the threshold within the planned hands at win
// rate mu. R falls as mu rises, which gives three things without simulation:
//   - risk quantiles: the q-quantile of R(mu) is R at the (1 - q) quantile of mu;
//   - "posterior probability >= q that risk <= target": R at the (1 - q)
//     quantile of mu must be <= target, so the bankroll is one root in B;
//   - average risk E[R(mu)]: closed form for a Normal posterior (averageRisk).

const { ValidationError } = require("./errors.js");
const { logPhi, phi, normalQuantile, brownFinite } = require("./brownian.js");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Change `version` whenever the same inputs would give different numbers.
const POSTERIOR_MODEL = Object.freeze({
  name: "bankroll-posterior",
  version: "2026-10-22",
  likelihood: "observed win rate ~ Normal(true win rate, (volatility / sqrt(hands / 100))^2), volatility held fixed",
  posterior: "Normal-Normal conjugate update",
  risk: "finite-horizon Brownian first passage; average over the posterior in closed form",
});

const PRIORS = Object.freeze({
  none: Object.freeze({ id: "none", mean: 0, sd: Infinity, label: "None (results only)" }),
  weak: Object.freeze({ id: "weak", mean: 0, sd: 10, label: "Weakly informative, Normal(0, 10²)" }),
  skeptical: Object.freeze({ id: "skeptical", mean: 0, sd: 2, label: "Skeptical, Normal(0, 2²)" }),
});
const VOLATILITY_ASSUMPTIONS = [70, 90, 120, 150];
const SAMPLE_MULTIPLES = [0.25, 1, 4, 16];
const INTERVAL_LEVEL = 0.95;
const CURVE_POINTS = 61;

function number(value, label, min, max, unit = "") {
  const parsed = Number(value);
  if (value === null || value === "" || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${label} must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")}${unit}.`);
  }
  return parsed;
}

function choice(value, label, options, fallback) {
  const chosen = value ?? fallback;
  if (!options.includes(chosen)) throw new ValidationError(`${label} must be one of: ${options.join(", ")}.`);
  return chosen;
}

function normalizePosteriorInput(input) {
  const p = {
    hands: Math.round(number(input.hands, "Hands played", 100, 100000000)),
    winRate: number(input.winRate, "Net win rate", -200, 200, " bb/100"),
    sd: number(input.sd, "Volatility", 10, 500, " bb/100"),
    sdSource: choice(input.sdSource, "Volatility source", ["tracker", "assumed", "sessions"], "assumed"),
    prior: choice(input.prior, "Prior", Object.keys(PRIORS), "weak"),
    bankBuyIns: number(input.bank, "Bankroll", 0.1, 100000, " buy-ins"),
    thresholdBuyIns: number(input.thr ?? 0, "Ruin threshold", 0, 100000, " buy-ins"),
    bbPerBuyIn: number(input.bbPerBuyIn ?? 100, "Big blinds per buy-in", 1, 1000),
    horizon: Math.round(number(input.horizon, "Hands you plan to play", 100, 10000000)),
    target: number(input.target ?? 5, "Risk target", 0.1, 50, "%") / 100,
    credibility: number(input.credibility ?? 80, "Posterior probability", 50, 99.9, "%") / 100,
    margin: number(input.margin ?? 1, "Precision", 0.1, 100, " bb/100"),
    sampleLevel: number(input.sampleLevel ?? 95, "Interval level", 50, 99.9, "%") / 100,
    // From imported sessions: the volatility's 95% interval (extra rows in the
    // volatility table) and how much to widen the win rate's standard error
    // when its stability check finds the win rate changing over time.
    sdRange: null,
    seMultiplier: number(input.seMultiplier ?? 1, "Standard-error multiplier", 1, 10),
  };
  if (input.sdRange != null) {
    if (!Array.isArray(input.sdRange) || input.sdRange.length !== 2) throw new ValidationError("The volatility range must be two numbers.");
    const [low, high] = input.sdRange.map((v) => number(v, "The volatility range", 10, 500, " bb/100"));
    if (!(low <= p.sd && p.sd <= high)) throw new ValidationError("The volatility range must contain the volatility.");
    p.sdRange = [low, high];
  }
  if (p.bankBuyIns <= p.thresholdBuyIns) throw new ValidationError("Bankroll must be above the ruin threshold.");
  p.bank = p.bankBuyIns * p.bbPerBuyIn;
  p.thr = p.thresholdBuyIns * p.bbPerBuyIn;
  return p;
}

// Normal posterior for the true win rate. `dataWeight` is the share of the
// posterior precision that comes from the results (1 with no prior).
// `multiplier` widens the standard error (sessions whose win rate drifts).
function posterior(observed, hands, sd, prior, multiplier = 1) {
  const standardError = (multiplier * sd) / Math.sqrt(hands / 100);
  const dataPrecision = 1 / (standardError * standardError);
  const priorPrecision = Number.isFinite(prior.sd) ? 1 / (prior.sd * prior.sd) : 0;
  const precision = dataPrecision + priorPrecision;
  const mean = (observed * dataPrecision + prior.mean * priorPrecision) / precision;
  const sdPost = Math.sqrt(1 / precision);
  return { mean, sd: sdPost, standardError, dataWeight: dataPrecision / precision, probPositive: phi(mean / sdPost) };
}

// E[R(mu)] for mu ~ Normal(mean, sd^2), exactly. With h = hands / 100,
// b = bankroll - threshold and v^2 = sigma^2 h + (sd h)^2 (the predictive
// variance of the total result over the horizon):
//   E[Phi((-b - mu h) / (sigma sqrt h))] = Phi((-b - mean h) / v)
//   E[exp(-2 mu b / sigma^2) Phi((-b + mu h) / (sigma sqrt h))]
//     = exp(-2 mean b / sigma^2 + 2 b^2 sd^2 / sigma^4) Phi((-b + (mean - 2 b sd^2 / sigma^2) h) / v)
// The second line completes the square; it is combined in log space, as in
// brownFinite, because the exponential and Phi can overflow and underflow.
function averageRisk(mean, sd, sigma, bankroll, threshold, hands) {
  const b = bankroll - threshold;
  if (b <= 0) return 1;
  const h = hands / 100;
  const sigma2 = sigma * sigma;
  const v = Math.sqrt(sigma2 * h + sd * sd * h * h);
  const first = logPhi((-b - mean * h) / v);
  const shifted = mean - (2 * b * sd * sd) / sigma2;
  const second = (-2 * mean * b) / sigma2 + (2 * b * b * sd * sd) / (sigma2 * sigma2) + logPhi((-b + shifted * h) / v);
  return clamp(Math.exp(first) + Math.exp(second), 0, 1);
}

// Smallest bankroll (bb) whose risk is at most `target`, for a risk function
// that falls as the bankroll grows. Bisection to a relative 1e-10.
function bankrollFor(riskAt, target, threshold, scale) {
  let low = threshold;
  let high = threshold + Math.max(1, scale);
  while (riskAt(high) > target) {
    low = high;
    high = threshold + 2 * (high - threshold);
    if (high - threshold > 1e13) return null;
  }
  for (let i = 0; i < 300 && high - low > 1e-10 * (high - threshold); i += 1) {
    const middle = (low + high) / 2;
    if (riskAt(middle) > target) low = middle;
    else high = middle;
  }
  return high;
}

// The win rate at which model risk equals `target` (risk falls as it rises).
function winRateFor(riskAt, target) {
  let low = -1;
  let high = 1;
  while (riskAt(low) <= target && low > -1e7) low *= 2;
  while (riskAt(high) > target && high < 1e7) high *= 2;
  for (let i = 0; i < 300 && high - low > 1e-12 * Math.max(1, Math.abs(high)); i += 1) {
    const middle = (low + high) / 2;
    if (riskAt(middle) > target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// Everything that depends on one choice of volatility, prior and sample size.
function evaluate(p, sd, prior, hands) {
  const post = posterior(p.winRate, hands, sd, prior, p.seMultiplier);
  const zInterval = normalQuantile(0.5 + INTERVAL_LEVEL / 2);
  const interval = [post.mean - zInterval * post.sd, post.mean + zInterval * post.sd];
  // Risk is at most its q-quantile with posterior probability q, and that
  // quantile is the risk at the (1 - q) quantile of the win rate.
  const credibleWinRate = post.mean - normalQuantile(p.credibility) * post.sd;
  const riskAt = (winRate, bank = p.bank) => brownFinite(winRate, sd, bank, p.thr, p.horizon);
  const scale = sd * Math.sqrt(p.horizon / 100);
  const credibleBankroll = bankrollFor((bank) => riskAt(credibleWinRate, bank), p.target, p.thr, scale);
  const breakEvenWinRate = winRateFor((winRate) => riskAt(winRate), p.target);
  return {
    sd, prior: prior.id, hands,
    winRate: { ...post, interval, credible: credibleWinRate },
    risk: {
      plugIn: riskAt(p.winRate),
      average: averageRisk(post.mean, post.sd, sd, p.bank, p.thr, p.horizon),
      median: riskAt(post.mean),
      interval: [riskAt(interval[1]), riskAt(interval[0])],
      upper: riskAt(credibleWinRate),
      // P(R(mu) <= target) = P(mu >= the win rate where R equals the target).
      probAtMostTarget: phi((post.mean - breakEvenWinRate) / post.sd),
      targetWinRate: breakEvenWinRate,
    },
    bankroll: {
      credible: credibleBankroll,
      average: bankrollFor((bank) => averageRisk(post.mean, post.sd, sd, bank, p.thr, p.horizon), p.target, p.thr, scale),
      plugIn: bankrollFor((bank) => riskAt(p.winRate, bank), p.target, p.thr, scale),
    },
  };
}

// Hands for a central interval of +/- margin bb/100 from results alone, with
// independent results, a stable win rate and the given volatility (times the
// standard-error multiplier, when one is used).
function sampleSize(sd, margin, level, hands, multiplier = 1) {
  const z = normalQuantile(0.5 + level / 2);
  const total = 100 * ((z * sd * multiplier) / margin) ** 2;
  return {
    level, margin, z,
    currentHalfWidth: (z * sd * multiplier) / Math.sqrt(hands / 100),
    totalHands: Math.ceil(total),
    moreHands: Math.max(0, Math.ceil(total) - hands),
  };
}

function computeBankrollPosterior(input) {
  const p = normalizePosteriorInput(input);
  const prior = PRIORS[p.prior];
  const main = evaluate(p, p.sd, prior, p.hands);
  const buyIns = (bb) => (bb === null ? null : bb / p.bbPerBuyIn);
  const answer = (bb) => ({
    bb, buyIns: buyIns(bb), met: bb !== null && p.bank >= bb,
    moreBuyIns: bb === null ? null : Math.max(0, (bb - p.bank) / p.bbPerBuyIn),
  });
  const row = (result, extra) => ({
    ...extra,
    posteriorMean: result.winRate.mean,
    interval: result.winRate.interval,
    probPositive: result.winRate.probPositive,
    averageRisk: result.risk.average,
    upperRisk: result.risk.upper,
    requiredBuyIns: buyIns(result.bankroll.credible),
  });

  const volatilities = [...new Set([...VOLATILITY_ASSUMPTIONS, p.sd, ...(p.sdRange || [])])].sort((a, b) => a - b);
  const byVolatility = volatilities.map((sd) => {
    const result = sd === p.sd ? main : evaluate(p, sd, prior, p.hands);
    const bound = p.sdRange && sd !== p.sd ? (sd === p.sdRange[0] ? "low" : sd === p.sdRange[1] ? "high" : null) : null;
    return row(result, { sd, current: sd === p.sd, bound, handsForMargin: sampleSize(sd, p.margin, p.sampleLevel, p.hands, p.seMultiplier).totalHands });
  });
  // The spread across the assumptions (and the volatility in use), leaving out
  // the extra rows for the ends of an estimated volatility's interval.
  const assumed = byVolatility.filter((r) => !r.bound || VOLATILITY_ASSUMPTIONS.includes(r.sd));
  const byPrior = Object.values(PRIORS).map((option) => {
    const result = option.id === p.prior ? main : evaluate(p, p.sd, option, p.hands);
    return row(result, { prior: option.id, label: option.label, current: option.id === p.prior, dataWeight: result.winRate.dataWeight });
  });
  const bySample = SAMPLE_MULTIPLES.map((multiple) => {
    const hands = Math.max(100, Math.round(p.hands * multiple));
    const result = multiple === 1 ? main : evaluate(p, p.sd, prior, hands);
    return row(result, { hands, multiple, current: multiple === 1 });
  });

  // Where the uncertainty comes from, one input at a time: the win rate's own
  // posterior (95% interval of risk) against the spread of the average risk
  // across the volatility assumptions and across the priors.
  const span = (values) => [Math.min(...values), Math.max(...values)];
  const sources = [
    { id: "winRate", range: main.risk.interval },
    { id: "volatility", range: span(assumed.map((r) => r.averageRisk)), values: assumed.map((r) => r.sd) },
    { id: "prior", range: span(byPrior.map((r) => r.averageRisk)) },
  ];
  const widest = sources.reduce((best, source) => (source.range[1] - source.range[0] > best.range[1] - best.range[0] ? source : best));

  // Risk against bankroll under the three readings of "risk".
  const top = Math.max(main.bankroll.credible ?? p.bank, main.bankroll.average ?? p.bank, p.bank) - p.thr;
  const curve = { bankroll: [], plugIn: [], average: [], upper: [] };
  for (let i = 0; i < CURVE_POINTS; i += 1) {
    const bank = p.thr + (1.3 * top * i) / (CURVE_POINTS - 1);
    curve.bankroll.push(bank / p.bbPerBuyIn);
    curve.plugIn.push(brownFinite(p.winRate, p.sd, bank, p.thr, p.horizon));
    curve.average.push(averageRisk(main.winRate.mean, main.winRate.sd, p.sd, bank, p.thr, p.horizon));
    curve.upper.push(brownFinite(main.winRate.credible, p.sd, bank, p.thr, p.horizon));
  }

  return {
    inputs: {
      hands: p.hands, winRate: p.winRate, sd: p.sd, sdSource: p.sdSource, prior: p.prior, priorLabel: prior.label,
      bank: p.bankBuyIns, thr: p.thresholdBuyIns, bbPerBuyIn: p.bbPerBuyIn, horizon: p.horizon,
      target: p.target, credibility: p.credibility, margin: p.margin, sampleLevel: p.sampleLevel,
      sdRange: p.sdRange, seMultiplier: p.seMultiplier,
    },
    winRate: {
      observed: p.winRate,
      standardError: main.winRate.standardError,
      mean: main.winRate.mean,
      sd: main.winRate.sd,
      level: INTERVAL_LEVEL,
      interval: main.winRate.interval,
      probPositive: main.winRate.probPositive,
      dataWeight: main.winRate.dataWeight,
      credible: main.winRate.credible,
    },
    risk: { ...main.risk, target: p.target, credibility: p.credibility },
    bankroll: {
      current: { bb: p.bank, buyIns: p.bankBuyIns },
      credible: answer(main.bankroll.credible),
      average: answer(main.bankroll.average),
      plugIn: answer(main.bankroll.plugIn),
    },
    sampleSize: sampleSize(p.sd, p.margin, p.sampleLevel, p.hands, p.seMultiplier),
    sensitivity: { volatility: byVolatility, prior: byPrior, sample: bySample },
    sources: { items: sources, widest: widest.id },
    curve,
    model: POSTERIOR_MODEL,
  };
}

module.exports = {
  computeBankrollPosterior,
  normalizePosteriorInput,
  posterior,
  averageRisk,
  bankrollFor,
  sampleSize,
  PRIORS,
  POSTERIOR_MODEL,
};
