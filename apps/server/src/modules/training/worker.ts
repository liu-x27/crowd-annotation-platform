import { parentPort, workerData } from 'node:worker_threads';
import { runTraining } from './core';
import type { TrainingInput } from './data';

// Training is CPU-bound for seconds to minutes; running it here keeps the API responsive.
const port = parentPort!;
try {
  const out = runTraining(workerData as TrainingInput, (epoch) =>
    port.postMessage({ type: 'epoch', epoch }),
  );
  port.postMessage({ type: 'done', report: out.report, model: out.model });
} catch (err) {
  port.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
}
