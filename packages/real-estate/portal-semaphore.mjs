/**
 * Limit concurrent portal HTTP fetches — opt-in backpressure for scale.
 * Enable: JAB_RE_PORTAL_MAX_CONCURRENT=5 (default 0 = unlimited, existing behavior).
 */

let active = 0;
const queue = [];

export function portalMaxConcurrent() {
  return Math.max(0, Number(process.env.JAB_RE_PORTAL_MAX_CONCURRENT || 0));
}

export function isPortalSemaphoreEnabled() {
  return portalMaxConcurrent() > 0;
}

function drain() {
  const max = portalMaxConcurrent();
  if (!max) return;
  while (active < max && queue.length) {
    const job = queue.shift();
    active++;
    job()
      .catch(() => {})
      .finally(() => {
        active--;
        drain();
      });
  }
}

export function withPortalSlot(fn) {
  if (!isPortalSemaphoreEnabled()) return fn();
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await fn());
      } catch (error) {
        reject(error);
      }
    });
    drain();
  });
}

export function portalSemaphoreStats() {
  return { enabled: isPortalSemaphoreEnabled(), max: portalMaxConcurrent(), active, queued: queue.length };
}
