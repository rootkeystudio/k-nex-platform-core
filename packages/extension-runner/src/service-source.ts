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
const safeLog = (...values) => {
  const text = values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').slice(0, 4096);
  write({ type: 'log', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, text });
};
const rejectedCall = (code) => {
  const call = Promise.reject(new Error(code));
  call.catch(() => {});
  return call;
};
const joinAcceptedCalls = () => Promise.allSettled([...acceptedCalls]);
const host = Object.freeze({ call(capability, payload) {
  if (entrypointSettled) return rejectedCall('CAPABILITY_REQUEST_CLOSED');
  if (typeof capability !== 'string' || capability.length > 64 || jsonBytes(payload) > invocation.maxInputBytes) return rejectedCall('CAPABILITY_REQUEST_INVALID');
  sequence += 1;
  const call = new Promise((resolve, reject) => pending.set(sequence, { resolve, reject }));
  acceptedCalls.add(call);
  call.catch(() => {});
  write({ type: 'capability-request', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, sequence, capability, payload, token: invocation.token });
  return call;
} });
async function execute() {
  const context = vm.createContext({ console: Object.freeze({ log: safeLog, info: safeLog, warn: safeLog, error: safeLog }) }, { name: invocation.generationId, codeGeneration: { strings: false, wasm: false } });
  const module = new vm.SourceTextModule(invocation.source, { context, identifier: 'generation-entrypoint.mjs' });
  await module.link(() => { throw new Error('IMPORTS_FORBIDDEN'); });
  await module.evaluate();
  const entrypoint = module.namespace.default || module.namespace.run;
  if (typeof entrypoint !== 'function') throw new Error('ENTRYPOINT_INVALID');
  context.__entrypoint = entrypoint;
  context.__input = invocation.input;
  context.__host = host;
  let result;
  try {
    result = await new vm.Script('__entrypoint({ input: __input, host: __host })').runInContext(context);
  } finally {
    entrypointSettled = true;
    await joinAcceptedCalls();
  }
  const output = result === undefined ? null : result;
  if (jsonBytes(output) > invocation.maxOutputBytes) throw new Error('OUTPUT_BUDGET_EXCEEDED');
  write({ type: 'result', schemaVersion: 1, invocationId: invocation.invocationId, generationId: invocation.generationId, ok: true, output });
}
rl.on('line', (line) => {
  try {
    const frame = JSON.parse(line);
    if (!initialized) {
      if (!exact(frame, ['generationId','input','invocationId','maxInputBytes','maxOutputBytes','schemaVersion','source','token','type']) || frame.type !== 'invoke' || frame.schemaVersion !== 1 || typeof frame.source !== 'string' || typeof frame.token !== 'string') throw new Error('PROTOCOL_INVALID');
      invocation = frame;
      initialized = true;
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
