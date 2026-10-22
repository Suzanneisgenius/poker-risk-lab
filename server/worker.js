"use strict";

const { parentPort } = require("node:worker_threads");
const { compute } = require("./compute.js");

parentPort.on("message", ({ id, type, input }) => {
  try {
    parentPort.postMessage({ id, ok: true, result: compute(type, input) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Calculation failed." });
  }
});
