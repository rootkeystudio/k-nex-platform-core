export const runnerServiceSource = String.raw`
const readline = require('node:readline');
const vm = require('node:vm');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
let initialized = false;
let invocation;
let sequence = 0;
let entrypointSettled = false;
const pending = new Map();
const acceptedCalls = new Set();
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));
const writeLog = (text) => {
  write({ type: 'log', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, text });
};
const joinAcceptedCalls = () => Promise.allSettled([...acceptedCalls]);
const settleEntrypoint = () => { entrypointSettled = true; };
const hostCall = (requestJson) => {
  let request;
  try {
    request = JSON.parse(requestJson);
  } catch {
    return JSON.stringify({ ok: false, error: 'CAPABILITY_REQUEST_INVALID' });
  }
  const { capability, payload } = request;
  if (entrypointSettled) return JSON.stringify({ ok: false, error: 'CAPABILITY_REQUEST_CLOSED' });
  if (typeof capability !== 'string' || capability.length > 64 || jsonBytes(payload) > invocation.maxInputBytes) return JSON.stringify({ ok: false, error: 'CAPABILITY_REQUEST_INVALID' });
  sequence += 1;
  const call = new Promise((resolve, reject) => pending.set(sequence, { resolve, reject }));
  acceptedCalls.add(call);
  call.catch(() => {});
  write({ type: 'capability-request', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, sequence, capability, payload, token: invocation.token });
  return call.then(
    (output) => JSON.stringify({ ok: true, output }),
    (error) => JSON.stringify({ ok: false, error: error && typeof error.message === 'string' ? error.message : 'CAPABILITY_FAILED' }),
  );
};
const contextBootstrap = [
  '(() => {',
  'const bridge = globalThis.__bridge;',
  'const logBridge = globalThis.__logBridge;',
  'const settleBridge = globalThis.__settleBridge;',
  'const inputJson = globalThis.__inputJson;',
  'delete globalThis.__bridge;',
  'delete globalThis.__logBridge;',
  'delete globalThis.__settleBridge;',
  'delete globalThis.__inputJson;',
  'const sendLog = (...values) => {',
  '  let text;',
  '  try { text = values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "); } catch { text = "[unserializable]"; }',
  '  logBridge(text.slice(0, 4096));',
  '};',
  'globalThis.console = Object.freeze({ log: sendLog, info: sendLog, warn: sendLog, error: sendLog });',
  'const host = Object.freeze({ call(capability, payload) {',
  '  return Promise.resolve(bridge(JSON.stringify({ capability, payload }))).then((responseJson) => {',
  '    const response = JSON.parse(responseJson);',
  '    if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : "CAPABILITY_FAILED");',
  '    return response.output;',
  '  });',
  '} });',
  'return (entrypoint) => {',
  '  const output = entrypoint({ input: JSON.parse(inputJson), host });',
  '  if (!output || typeof output.then !== "function") { settleBridge(); return JSON.stringify(output ?? null); }',
  '  return Promise.resolve(output).then((value) => { settleBridge(); return JSON.stringify(value ?? null); }, (error) => { settleBridge(); throw error; });',
  '};',
  '})();',
].join('\n');
async function execute() {
  // A normal object inherits the host Object constructor through the contextified
  // global, which makes its constructor chain an outer-realm Function escape.
  const context = vm.createContext(Object.create(null), { name: invocation.generationId, codeGeneration: { strings: false, wasm: false } });
  context.__bridge = hostCall;
  context.__logBridge = writeLog;
  context.__settleBridge = settleEntrypoint;
  context.__inputJson = JSON.stringify(invocation.input);
  const runEntrypoint = new vm.Script(contextBootstrap).runInContext(context);
  const module = new vm.SourceTextModule(invocation.source, { context, identifier: 'generation-entrypoint.mjs' });
  await module.link(() => { throw new Error('IMPORTS_FORBIDDEN'); });
  await module.evaluate();
  const entrypoint = module.namespace.default || module.namespace.run;
  if (typeof entrypoint !== 'function') throw new Error('ENTRYPOINT_INVALID');
  let outputJson;
  try {
    outputJson = await runEntrypoint(entrypoint);
  } finally {
    entrypointSettled = true;
    await joinAcceptedCalls();
  }
  if (Buffer.byteLength(outputJson) > invocation.maxOutputBytes) throw new Error('OUTPUT_BUDGET_EXCEEDED');
  const output = JSON.parse(outputJson);
  write({ type: 'result', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, ok: true, output });
}
rl.on('line', (line) => {
  try {
    const frame = JSON.parse(line);
    if (!initialized) {
      if (!exact(frame, ['generationId','input','invocationId','maxInputBytes','maxOutputBytes','schemaVersion','source','token','type']) || frame.type !== 'invoke' || frame.schemaVersion !== 1 || typeof frame.source !== 'string' || typeof frame.token !== 'string') throw new Error('PROTOCOL_INVALID');
      invocation = frame;
      initialized = true;
      write({ type: 'invoke-ack', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId });
      execute().catch(() => write({ type: 'result', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, ok: false, error: { code: 'APPLICATION_FAILED' } })).finally(() => { rl.close(); });
      return;
    }
    if (!exact(frame, ['error','generationId','invocationId','ok','output','schemaVersion','sequence','type']) || frame.type !== 'capability-response' || frame.schemaVersion !== 1 || frame.invocationId !== invocation.invocationId || frame.generationId !== invocation.generationId || !Number.isSafeInteger(frame.sequence)) throw new Error('PROTOCOL_INVALID');
    const waiter = pending.get(frame.sequence);
    if (!waiter) throw new Error('SEQUENCE_INVALID');
    pending.delete(frame.sequence);
    if (frame.ok === true) waiter.resolve(frame.output); else waiter.reject(new Error(frame.error && typeof frame.error.code === 'string' ? frame.error.code : 'CAPABILITY_FAILED'));
  } catch {
    write({ type: 'protocol-error', schemaVersion: 1, code: 'PROTOCOL_INVALID' });
    process.exitCode = 65;
    rl.close();
  }
});
rl.on('close', () => { if (!initialized) process.exitCode = 65; });
`;
