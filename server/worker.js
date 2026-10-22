"use strict";

const { parentPort } = require("node:worker_threads");
const { compute } = require("./compute.js");
const { ValidationError } = require("./errors.js");

parentPort.on("message", ({ id, type, input }) => {
  try {
    parentPort.postMessage({ id, ok: true, result: compute(type, input) });
  } catch (error) {
    // Error subclasses do not survive postMessage, so carry the kind explicitly.
    const invalid = error instanceof ValidationError;
    parentPort.postMessage({
      id,
      ok: false,
      error: invalid ? error.message : "Calculation failed.",
      invalid,
      status: invalid ? error.status : undefined,
    });
  }
});
