"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

class CalculationPool {
  constructor(size = 2, maxQueue = 16) {
    this.size = size;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.nextId = 1;
    this.queue = [];
  }

  run(type, input, timeoutMs = 45000) {
    if (this.queue.length + this.active >= this.maxQueue) {
      return Promise.reject(new Error("The calculation service is busy. Please try again in a moment."));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, type, input, timeoutMs, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.size && this.queue.length) this.start(this.queue.shift());
  }

  start(task) {
    this.active += 1;
    const worker = new Worker(path.join(__dirname, "worker.js"));
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      this.active -= 1;
      callback();
      this.drain();
    };
    const timer = setTimeout(() => finish(() => task.reject(new Error("Calculation timed out. Try a lower precision setting."))), task.timeoutMs);
    worker.once("message", (message) => finish(() => message.ok ? task.resolve(message.result) : task.reject(new Error(message.error))));
    worker.once("error", () => finish(() => task.reject(new Error("Calculation worker failed. Please try again."))));
    worker.postMessage({ id: task.id, type: task.type, input: task.input });
  }
}

module.exports = { CalculationPool };
