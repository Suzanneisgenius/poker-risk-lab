"use strict";

// Resolve the address used for rate limiting.
//
// Proxies append the address they received the request from to
// X-Forwarded-For, so only the rightmost `trustedHops` entries were written by
// infrastructure we control. Everything to their left is client-supplied and
// can be forged, so it must never be used as a rate-limit key. With
// `trustedHops = 0` the header is ignored and the socket address is used.
function clientIp(request, trustedHops = 0) {
  if (trustedHops > 0) {
    const chain = String(request.headers["x-forwarded-for"] || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (chain.length >= trustedHops) return chain[chain.length - trustedHops];
  }
  return request.socket?.remoteAddress || "unknown";
}

module.exports = { clientIp };
