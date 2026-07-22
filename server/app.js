"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { CalculationPool } = require("./pool.js");

const ROOT = path.resolve(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");
const PORT = Number(process.env.PORT) || 4174;
const HOST = process.env.HOST || "0.0.0.0";
const pool = new CalculationPool(Math.max(1, Math.min(4, Number(process.env.CALC_WORKERS) || 2)), 16);
const rateBuckets = new Map();
const calculationCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;

const routes = new Map([
  ["/api/equity", { type: "equity", weight: 3, timeout: 30000 }],
  ["/api/ev", { type: "ev", weight: 1, timeout: 10000 }],
  ["/api/bankroll", { type: "bankroll", weight: 8, timeout: 45000 }],
  ["/api/risk-lab", { type: "risk-lab", weight: 12, timeout: 55000 }],
  ["/api/gto", { type: "gto", weight: 10, timeout: 45000 }],
]);

function securityHeaders(contentType, api = false) {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.plot.ly; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cache-Control": api ? "no-store" : "public, max-age=300",
  };
}

function json(response, status, body, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...securityHeaders("application/json; charset=utf-8", true), ...extraHeaders });
  response.end(JSON.stringify(body));
}

function cacheKey(type, input) {
  return crypto.createHash("sha256").update(type).update("\0").update(JSON.stringify(input)).digest("base64url");
}

function cachedResult(key) {
  const entry = calculationCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    calculationCache.delete(key);
    return null;
  }
  // Refresh insertion order so frequently compared scenarios remain available.
  calculationCache.delete(key);
  calculationCache.set(key, entry);
  return entry.result;
}

function rememberResult(key, result) {
  calculationCache.delete(key);
  while (calculationCache.size >= CACHE_MAX_ENTRIES) {
    calculationCache.delete(calculationCache.keys().next().value);
  }
  calculationCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function chargeRateLimit(request, weight) {
  const now = Date.now();
  const key = clientIp(request);
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60000) bucket = { startedAt: now, used: 0 };
  bucket.used += weight;
  rateBuckets.set(key, bucket);
  return { allowed: bucket.used <= 80, retryAfter: Math.max(1, Math.ceil((60000 - (now - bucket.startedAt)) / 1000)) };
}

setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [key, bucket] of rateBuckets) if (bucket.startedAt < cutoff) rateBuckets.delete(key);
}, 60000).unref();

function requestWeight(route, input) {
  let weight = route.weight;
  if ((route.type === "risk-lab" || route.type === "bankroll") && Number(input?.paths) > 10000) weight += 18;
  if (route.type === "gto" && Number(input?.iterations) > 300000) weight += 10;
  if (route.type === "equity" && Number(input?.trials) > 75000) weight += 5;
  return weight;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (request.socket.encrypted ? "https" : "http");
  const host = request.headers.host;
  return Boolean(host) && origin === `${protocol}://${host}`;
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new Error("Send the request as application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32768) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) throw new Error("Request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must contain valid JSON.");
  }
}

async function handleApi(request, response, route) {
  if (request.method !== "POST") {
    json(response, 405, { error: "Use POST for calculations." }, { Allow: "POST" });
    return;
  }
  if (!sameOrigin(request)) {
    json(response, 403, { error: "Cross-origin calculation requests are not allowed." });
    return;
  }
  try {
    const input = await readJson(request);
    const key = cacheKey(route.type, input);
    const cached = cachedResult(key);
    if (cached) {
      json(response, 200, cached, { "X-Calculation-Cache": "HIT" });
      return;
    }
    const rate = chargeRateLimit(request, requestWeight(route, input));
    if (!rate.allowed) {
      json(response, 429, { error: "Too many calculations. Please wait a moment and try again." }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const cancelOnClose = () => {
      if (!response.writableEnded) cancel();
    };
    request.once("aborted", cancel);
    response.once("close", cancelOnClose);
    try {
      const result = await pool.run(route.type, input, route.timeout, { signal: controller.signal });
      rememberResult(key, result);
      json(response, 200, result, { "X-Calculation-Cache": "MISS" });
    } finally {
      request.removeListener("aborted", cancel);
      response.removeListener("close", cancelOnClose);
    }
  } catch (error) {
    if (response.destroyed || response.writableEnded || error?.name === "AbortError") return;
    const message = error instanceof Error ? error.message : "Calculation failed.";
    const isInputError = /must|invalid|Choose|same card|above|JSON|Request body|Send the request/.test(message);
    json(response, isInputError ? 400 : 503, { error: message });
  }
}

async function handler(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname === "/api/health") {
    if (request.method !== "GET") return json(response, 405, { error: "Use GET for health checks." }, { Allow: "GET" });
    return json(response, 200, { ok: true, service: "poker-analytics-api" });
  }
  const apiRoute = routes.get(url.pathname);
  if (apiRoute) return handleApi(request, response, apiRoute);
  if (url.pathname.startsWith("/api/")) return json(response, 404, { error: "API endpoint not found." });

  if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const page = await fs.readFile(INDEX);
      response.writeHead(200, securityHeaders("text/html; charset=utf-8"));
      if (request.method === "HEAD") response.end();
      else response.end(page);
    } catch {
      json(response, 503, { error: "The frontend has not been built. Run npm run build." });
    }
    return;
  }
  json(response, 404, { error: "Not found." });
}

const server = http.createServer((request, response) => {
  handler(request, response).catch(() => json(response, 500, { error: "Unexpected server error." }));
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Poker Analytics Suite listening on http://${HOST}:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { server };
