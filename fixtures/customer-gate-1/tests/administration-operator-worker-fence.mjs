export function startAdministrationOperatorWorkerFenceHeartbeat({
  store,
  renewal,
  intervalMs,
  onFailure,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout
}) {
  if (typeof store?.renewWorkerFence !== "function" || typeof renewal !== "object" || renewal === null || typeof onFailure !== "function" ||
    !Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("Administration operator worker-fence heartbeat configuration is invalid.");
  }

  let active = true;
  let epoch = 0;
  let timer;
  let renewalQueue = Promise.resolve();
  const queueRenewal = () => {
    const result = renewalQueue.then(
      () => store.renewWorkerFence(renewal),
      () => store.renewWorkerFence(renewal)
    );
    renewalQueue = result.catch(() => undefined);
    return result;
  };
  const stopTimer = () => {
    epoch += 1;
    cancel(timer);
    timer = undefined;
  };
  const arm = (expectedEpoch) => {
    timer = schedule(async () => {
      if (!active || epoch !== expectedEpoch) return;
      try {
        await queueRenewal();
        if (active && epoch === expectedEpoch) arm(expectedEpoch);
      } catch (error) {
        if (!active || epoch !== expectedEpoch) return;
        active = false;
        stopTimer();
        queueMicrotask(() => onFailure(error));
      }
    }, intervalMs);
    timer?.unref?.();
  };
  arm(epoch);

  return Object.freeze({
    async stop() {
      if (active) {
        active = false;
        stopTimer();
      }
      await renewalQueue;
    }
  });
}
