/**
 * Preloaded into the server for the load run (node --import ./load/pool-probe.mjs …): times
 * how long each request waits for a connection from the pg pool and how long it keeps one,
 * and how busy the event loop is. Nothing in the app changes; the pool's connect() is
 * wrapped from outside. Writes POOL_PROBE_FILE (pool-probe.json) every second and on
 * SIGUSR2, which load/profile.mjs sends to read it at a given moment.
 */
import { writeFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import pg from 'pg';

const file = process.env.POOL_PROBE_FILE || 'pool-probe.json';
const waits = [];
let holdTotal = 0;
let maxWaiting = 0;
const pools = new WeakSet();
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();

const connect = pg.Pool.prototype.connect;
pg.Pool.prototype.connect = function (cb) {
  if (!pools.has(this)) {
    pools.add(this);
    this.on('acquire', (client) => {
      client.probeAcquiredAt = performance.now();
    });
    this.on('release', (_err, client) => {
      if (client.probeAcquiredAt != null) holdTotal += performance.now() - client.probeAcquiredAt;
    });
  }
  const t0 = performance.now();
  const waited = () => waits.push(performance.now() - t0);
  // pg-pool's own query() calls connect with a callback; drizzle's transactions use the promise.
  const result = cb
    ? connect.call(this, (err, client, release) => {
        if (!err) waited();
        cb(err, client, release);
      })
    : connect.call(this).then((client) => {
        waited();
        return client;
      });
  maxWaiting = Math.max(maxWaiting, this.waitingCount);
  return result;
};

function quantile(sorted, q) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}

function dump() {
  const sorted = Float64Array.from(waits).sort();
  const elu = performance.eventLoopUtilization();
  writeFileSync(
    file,
    JSON.stringify({
      at: Date.now(),
      checkouts: waits.length,
      waitTotalMs: waits.reduce((a, b) => a + b, 0),
      waitP50Ms: quantile(sorted, 0.5),
      waitP95Ms: quantile(sorted, 0.95),
      waitP99Ms: quantile(sorted, 0.99),
      waitMaxMs: sorted.length ? sorted[sorted.length - 1] : 0,
      holdTotalMs: holdTotal,
      maxWaiting,
      eventLoop: { idle: elu.idle, active: elu.active, delayP99Ms: delay.percentile(99) / 1e6 },
      cpuMicros: process.cpuUsage(),
    }),
  );
}

setInterval(dump, 1000).unref();
process.on('SIGUSR2', dump);
