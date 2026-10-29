// Container HEALTHCHECK for the services image (Dockerfile): DUELOOP_SERVICE picks what "healthy" means.
//   webhooks          GET /health on its own port answers 200 (liveness; /ready is for the load balancer)
//   worker|processor  this container wrote a heartbeat in the last HEALTH_MAX_AGE seconds (default 300)
// Exit 0 = healthy, 1 = unhealthy (Docker HEALTHCHECK contract). Prints nothing (no values in container logs).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const service = process.env.DUELOOP_SERVICE ?? 'worker';
if (service === 'webhooks') {
  const port = Number(process.env.PORT ?? 8787);
  const ok = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.ok)
    .catch(() => false);
  process.exitCode = ok ? 0 : 1;
} else {
  const ops = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ops.ts');
  const r = spawnSync(process.execPath, [ops, 'alive', '--service', service, '--max-age', process.env.HEALTH_MAX_AGE ?? '300'], { stdio: 'ignore', timeout: 8000 });
  process.exitCode = r.status === 0 ? 0 : 1;
}
