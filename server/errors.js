"use strict";

// Raised for anything the caller can fix by changing the request. The HTTP
// layer maps it to a 4xx status; every other error becomes a 503.
class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

module.exports = { ValidationError };
