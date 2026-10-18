/**
 * Preloaded into the server for the load run beside load/pool-probe.mjs (node --import
 * ./load/cpu-probe.mjs …): a V8 CPU profile of the server's main thread while k6 submits.
 * It starts at the first submit, so setup (accounts, items) is left out, and stops at the
 * next SIGUSR2, which load/profile.mjs sends to read the probes once k6 is done. It then
 * writes the profile to CPU_PROFILE_FILE (server.cpuprofile, for Chrome DevTools) and the
 * requests it covered, by kind, to CPU_PROBE_FILE (cpu-probe.json), for load/cpu-report.mjs.
 * Nothing in the app changes; requests are counted from Node's diagnostics channel.
 */
import { subscribe } from 'node:diagnostics_channel';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';

const profileFile = process.env.CPU_PROFILE_FILE || 'server.cpuprofile';
const probeFile = process.env.CPU_PROBE_FILE || 'cpu-probe.json';
const requests = { submit: 0, queue: 0, other: 0 };
let session = null;
let startedAt = 0;
let done = false;

const kind = (url) =>
  /\/annotations\/\d+\/submit$/.test(url) ? 'submit' : /\/queue$/.test(url) ? 'queue' : 'other';

subscribe('http.server.request.start', ({ request }) => {
  const url = request.url ?? '';
  if (!session && !done && kind(url) === 'submit') {
    session = new Session();
    session.connect();
    startedAt = Date.now();
    void session
      .post('Profiler.enable')
      .then(() => session.post('Profiler.setSamplingInterval', { interval: 1000 }))
      .then(() => session.post('Profiler.start'));
  }
  if (session) requests[kind(url)]++;
});

process.on('SIGUSR2', async () => {
  if (!session || done) return;
  done = true;
  const stoppedAt = Date.now();
  const { profile } = await session.post('Profiler.stop');
  session.disconnect();
  writeFileSync(profileFile, JSON.stringify(profile));
  writeFileSync(probeFile, JSON.stringify({ startedAt, stoppedAt, requests }));
});
