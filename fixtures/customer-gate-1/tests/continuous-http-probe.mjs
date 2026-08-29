const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function startContinuousHttpProbe({ url, path = "/", initialWindow, initialGenerations, generation = (body) => body.generationId ?? body.generation, intervalMs = 15 }) {
  const samples = [];
  const failures = [];
  const windows = new Map();
  let currentWindow;
  let probing = true;
  let paused = false;
  let pending = Promise.resolve();

  const transition = (name, allowedGenerations) => {
    currentWindow = name;
    windows.set(name, [...allowedGenerations]);
  };
  transition(initialWindow, initialGenerations);

  const probe = (async () => {
    while (probing) {
      if (paused) { await delay(intervalMs); continue; }
      pending = (async () => {
        try {
          const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(1_000) });
          const body = await response.json();
          const generationId = generation(body);
          const allowed = windows.get(currentWindow) ?? [];
          samples.push({ window: currentWindow, generationId, status: response.status });
          if (!response.ok) failures.push(`${currentWindow}:status:${response.status}:${body.error ?? "unknown"}`);
          else if (!allowed.includes(generationId)) failures.push(`${currentWindow}:generation:${generationId}`);
        } catch (error) {
          if (probing) failures.push(`${currentWindow}:${error}`);
        }
      })();
      await pending;
      if (probing) await delay(intervalMs);
    }
  })();

  const waitForGeneration = async (name, generationId) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (samples.some((sample) => sample.window === name && sample.generationId === generationId)) return;
      await delay(intervalMs);
    }
    throw new Error(`Continuous HTTP probe did not observe ${generationId} during ${name}.`);
  };

  return {
    samples,
    transition,
    waitForGeneration,
    async stop() { probing = false; await probe; },
    async pause() { paused = true; await pending; },
    resume() { paused = false; },
    summary() {
      return Object.fromEntries([...windows.keys()].map((name) => [name, Object.fromEntries(samples
        .filter((sample) => sample.window === name)
        .reduce((counts, sample) => counts.set(sample.generationId, (counts.get(sample.generationId) ?? 0) + 1), new Map()))]));
    },
    assertEvidence(expectedWindows) {
      if (failures.length) throw new Error(`Continuous HTTP probe failures: ${failures.join(", ")}`);
      for (const [name, expected] of Object.entries(expectedWindows)) {
        const observed = new Set(samples.filter((sample) => sample.window === name).map((sample) => sample.generationId));
        if (!expected.every((generationId) => observed.has(generationId))) {
          throw new Error(`Continuous HTTP probe missing ${name} generations: expected ${expected.join(", ")}, observed ${[...observed].join(", ")}.`);
        }
      }
    }
  };
}
