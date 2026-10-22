"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { ValidationError } = require("./errors.js");

function cancelledError() {
  const error = new Error("Calculation cancelled.");
  error.name = "AbortError";
  return error;
}

class CalculationPool {
  constructor(size = 2, maxQueue = 16) {
    this.size = size;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.nextId = 1;
    this.queue = [];
  }

  run(type, input, timeoutMs = 45000, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(cancelledError());
    if (this.queue.length + this.active >= this.maxQueue) {
      return Promise.reject(new Error("The calculation service is busy. Please try again in a moment."));
    }
    return new Promise((resolve, reject) => {
      const task = { id: this.nextId++, type, input, timeoutMs, resolve, reject, signal, started: false };
      task.queuedAbort = () => {
        if (task.started) return;
        const index = this.queue.indexOf(task);
        if (index === -1) return;
        this.queue.splice(index, 1);
        reject(cancelledError());
      };
      signal?.addEventListener("abort", task.queuedAbort, { once: true });
      this.queue.push(task);
      this.drain();
    });
  }

  drain() {
    while (this.active < this.size && this.queue.length) this.start(this.queue.shift());
  }

  start(task) {
    task.started = true;
    task.signal?.removeEventListener("abort", task.queuedAbort);
    this.active += 1;
    const worker = new Worker(path.join(__dirname, "worker.js"));
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      task.signal?.removeEventListener("abort", abortActive);
      worker.terminate().catch(() => {});
      this.active -= 1;
      callback();
      this.drain();
    };
    const abortActive = () => finish(() => task.reject(cancelledError()));
    task.signal?.addEventListener("abort", abortActive, { once: true });
    timer = setTimeout(() => finish(() => task.reject(new Error("Calculation timed out. Try a lower precision setting."))), task.timeoutMs);
    worker.once("message", (message) => finish(() => {
      if (message.ok) task.resolve(message.result);
      else task.reject(message.invalid ? new ValidationError(message.error, message.status) : new Error(message.error));
    }));
    worker.once("error", () => finish(() => task.reject(new Error("Calculation worker failed. Please try again."))));
    if (task.signal?.aborted) {
      abortActive();
      return;
    }
    worker.postMessage({ id: task.id, type: task.type, input: task.input });
  }
}

module.exports = { CalculationPool };
