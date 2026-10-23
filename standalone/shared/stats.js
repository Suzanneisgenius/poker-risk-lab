"use strict";
// Distribution functions shared by the page and the server: the normal CDF and
// quantile, the regularized incomplete gamma and beta functions, and the
// chi-square and F distributions built on them. Plain JavaScript, no
// dependencies; checked against scipy in standalone/shared/test_sessions.js.
const PokerStats = (() => {
  // log(erfc(z)) for z >= 0. Chebyshev fit from Numerical Recipes (erfcc), with
  // fractional error below 1.2e-7 everywhere. Staying in log space means it
  // never underflows, however far into the tail z is.
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

  const phi = (x) => Math.exp(logPhi(x));

  // Inverse of the standard normal CDF: Wichura's AS 241 (PPND16), relative
  // error about 1e-16 for 1e-300 < p < 1 - 1e-16.
  function normalQuantile(p) {
    if (!(p > 0 && p < 1)) {
      if (p === 0) return -Infinity;
      if (p === 1) return Infinity;
      throw new RangeError("normalQuantile needs 0 <= p <= 1.");
    }
    const q = p - 0.5;
    if (Math.abs(q) <= 0.425) {
      const r = 0.180625 - q * q;
      return q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r
        + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r
        + 133.14166789178437745) * r + 3.387132872796366608)
        / (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r
        + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r
        + 42.313330701600911252) * r + 1);
    }
    let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
    let value;
    if (r <= 5) {
      r -= 1.6;
      value = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r
        + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r
        + 4.6303378461565452959) * r + 1.42343711074968357734)
        / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r
        + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r
        + 2.05319162663775882187) * r + 1);
    } else {
      r -= 5;
      value = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r
        + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r
        + 5.4637849111641143699) * r + 6.6579046435011037772)
        / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r
        + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r
        + 0.59983220655588793769) * r + 1);
    }
    return q < 0 ? -value : value;
  }

  // log Gamma(x) for x > 0: Lanczos approximation (g = 7, 9 terms), relative
  // error about 1e-15.
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function logGamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
    const y = x - 1;
    let a = LANCZOS[0];
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (y + i);
    const t = y + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Regularized lower incomplete gamma P(a, x): series below a + 1, Lentz's
  // continued fraction above (Numerical Recipes gser / gcf).
  function gammaP(a, x) {
    if (x <= 0) return 0;
    const front = Math.exp(-x + a * Math.log(x) - logGamma(a));
    if (x < a + 1) {
      let term = 1 / a, sum = term;
      for (let n = 1; n < 10000; n++) {
        term *= x / (a + n);
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
      }
      return Math.min(1, sum * front);
    }
    const tiny = 1e-300;
    let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
    for (let i = 1; i < 10000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const step = d * c;
      h *= step;
      if (Math.abs(step - 1) < 1e-16) break;
    }
    return Math.max(0, 1 - front * h);
  }

  // Continued fraction for the incomplete beta function (Numerical Recipes betacf).
  function betaFraction(a, b, x) {
    const tiny = 1e-300;
    let c = 1, d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m < 10000; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d; h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const step = d * c;
      h *= step;
      if (Math.abs(step - 1) < 1e-16) break;
    }
    return h;
  }

  // Regularized incomplete beta I_x(a, b).
  function betaI(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
    if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(a, b, x)) / a;
    return 1 - (front * betaFraction(b, a, 1 - x)) / b;
  }

  const chiSquareCdf = (x, k) => gammaP(k / 2, x / 2);
  const fCdf = (x, d1, d2) => (x <= 0 ? 0 : betaI(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2)));

  // Chi-square quantile by bisection on the CDF, to a relative 1e-13.
  function chiSquareQuantile(p, k) {
    if (!(p > 0 && p < 1)) throw new RangeError("chiSquareQuantile needs 0 < p < 1.");
    let low = 0, high = Math.max(1, k);
    while (chiSquareCdf(high, k) < p) { low = high; high *= 2; }
    for (let i = 0; i < 300 && high - low > 1e-13 * high; i++) {
      const middle = (low + high) / 2;
      if (chiSquareCdf(middle, k) < p) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  return { logErfc, logPhi, phi, normalQuantile, logGamma, gammaP, betaI, chiSquareCdf, chiSquareQuantile, fCdf };
})();
if (typeof module !== "undefined") module.exports = PokerStats;
