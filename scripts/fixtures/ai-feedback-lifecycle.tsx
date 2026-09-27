import { StrictMode, act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useAiInsightComponentFeedback, type UseAiInsightComponentFeedbackArgs } from '../../src/components/customers/use-ai-insight-component-feedback';
import { AiInsightComponentFeedbackClient } from '../../src/components/customers/ai-insight-component-feedback-client';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const realFetch = window.fetch.bind(window);
const counts = { loads: 0, resets: 0, emits: 0, renders: 0, gets: 0, puts: 0, subscriptions: 0 };
const clients = new Set<AiInsightComponentFeedbackClient>();
const constructedClients = new Set<AiInsightComponentFeedbackClient>();
const failures: string[] = [];
const results: string[] = [];
const checkpoints: Record<string, unknown> = {};
const originalConsoleError = console.error;
console.error = (...args) => { failures.push(args.map(String).join(' ')); originalConsoleError(...args); };
window.addEventListener('unhandledrejection', event => { failures.push(String(event.reason)); });
const proto = AiInsightComponentFeedbackClient.prototype;
for (const [method, counter] of [['load', 'loads'], ['reset', 'resets'], ['emit', 'emits']] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(proto, method)!;
  const original = descriptor.value;
  Object.defineProperty(proto, method, { ...descriptor, value: function (...args: unknown[]) {
    counts[counter]++; clients.add(this); return original.apply(this, args);
  } });
}
// buildSnapshot runs in the real constructor, including StrictMode's discarded
// initializer. Count construction separately from clients actually used by effects.
const snapshotDescriptor = Object.getOwnPropertyDescriptor(proto, 'buildSnapshot')!;
Object.defineProperty(proto, 'buildSnapshot', { ...snapshotDescriptor, value: function () {
  constructedClients.add(this);
  return snapshotDescriptor.value.call(this);
} });
const subscribe = proto.subscribe;
proto.subscribe = function(listener) {
  counts.subscriptions++;
  const unsubscribe = subscribe.call(this, listener);
  return () => { counts.subscriptions--; unsubscribe(); };
};
let api: ReturnType<typeof useAiInsightComponentFeedback>;
let args: UseAiInsightComponentFeedbackArgs = { customerId: 'synthetic-customer', insightReady: false, insightGeneratedAt: null, insightSourceHash: null };
const gen = { insightGeneratedAt: '2026-09-27T10:00:00Z', sourceHash: 'synthetic-a' };
let responseStatus = 200;
let hold: ((value: Response) => void) | null = null;
let deferGet = false;
let mismatch = false;
const body = () => ({ ok: true, generation: { insightGeneratedAt: args.insightGeneratedAt, sourceHash: args.insightSourceHash }, eligibility: { baseDeep: true, phase2: true, suggestedMessage: true }, feedback: { baseDeep: null, phase2: null, suggestedMessage: null } });
window.fetch = async (_input, init) => {
  if (init?.method === 'PUT') {
    counts.puts++;
    if (mismatch) return Response.json({ ok: false, errorCode: 'AI_FEEDBACK_GENERATION_MISMATCH' }, { status: 409 });
    const payload = JSON.parse(String(init.body));
    return Response.json({ ...body(), feedback: { ...body().feedback, baseDeep: { rating: payload.rating, tags: payload.tags, updatedAt: gen.insightGeneratedAt } } });
  }
  counts.gets++;
  if (deferGet) return new Promise<Response>(resolve => { hold = resolve; });
  return Response.json(body(), { status: responseStatus });
};
function check(value: unknown, message: string): void { if (!value) throw new Error(message); }
function Probe() {
  // Test instrumentation only: count attempted renders, including discarded ones.
  // eslint-disable-next-line react-hooks/immutability
  counts.renders++;
  // Test-only fail-fast prevents an unfixed implementation exhausting the browser.
  check(counts.renders < 200, 'runaway hook renders');
  const feedback = useAiInsightComponentFeedback(args);
  useLayoutEffect(() => { api = feedback; });
  return <p>{feedback.hydration}</p>;
}
const root = createRoot(document.getElementById('mount')!);
async function settle(action: () => void | Promise<void>) {
  await act(action);
  // Response.json resolves on a later task in browsers; drain test I/O explicitly.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
const render = () => settle(async () => { root.render(<StrictMode><Probe /></StrictMode>); });
const perform = async (name: string, test: () => Promise<void>) => {
  await test(); results.push(name);
  checkpoints[name] = { ...counts, usedClientInstances: clients.size, clientInstancesCreated: constructedClients.size };
};
async function run() {
  await perform('StrictMode idle is bounded with one mounted client', async () => {
    await render(); const before = { ...counts };
    await render(); await render();
    check(clients.size === 1, 'client recreated during StrictMode replay');
    check(counts.loads === before.loads && counts.emits === before.emits, 'idle rerender restarts load/reset');
    check(counts.gets === 0, 'idle fetched feedback');
    for (const client of clients) check(client.getSnapshot() === client.getSnapshot(), 'unstable snapshot');
  });
  await perform('false to true hydrates exactly one logical generation', async () => {
    args = { ...args, insightReady: true, insightGeneratedAt: gen.insightGeneratedAt, insightSourceHash: gen.sourceHash };
    await render(); check(api.hydration === 'ready', 'hydration ignored/disposed client'); check(counts.gets === 1, 'hydration GET duplicated');
  });
  await perform('same generation rerenders without GET storm', async () => {
    const before = counts.gets; await render(); await render(); check(counts.gets === before, 'same generation refetched');
  });
  await perform('generation change loads once', async () => {
    const before = counts.gets; args = { ...args, insightSourceHash: 'synthetic-b' }; await render(); check(counts.gets === before + 1 && api.hydration === 'ready', 'generation load');
  });
  for (const status of [403, 404, 500]) await perform(`${status} stable unavailable/error and retry`, async () => {
    responseStatus = status; await settle(async () => { api.retryLoad(); });
    check(api.hydration === (status === 500 ? 'error' : 'unavailable'), 'wrong failed state');
    const before = counts.gets; await render(); check(counts.gets === before, 'failure rerender retried automatically');
    responseStatus = 200; await settle(async () => { api.retryLoad(); }); check(api.hydration === 'ready', 'retry failed');
  });
  await perform('rating PUT remains explicit', async () => {
    check(counts.puts === 0, 'unexpected automatic PUT');
    await settle(async () => { api.submitRating('base_deep', 'helpful'); });
    check(counts.puts === 1, 'explicit rating not saved');
  });
  await perform('tag PUT remains explicit and persists', async () => {
    const before = counts.puts;
    await settle(async () => { api.toggleTag('base_deep', 'accurate_summary'); });
    check(counts.puts === before, 'tag draft wrote automatically');
    await settle(async () => { api.saveTags('base_deep'); });
    check(counts.puts === before + 1 && api.targets.base_deep.savedTags.includes('accurate_summary'), 'tag save failed');
  });
  await perform('mismatch clear and reload', async () => {
    mismatch = true; await settle(async () => { api.submitRating('base_deep', 'not_helpful'); });
    check(api.targets.base_deep.generationMismatch, 'missing mismatch');
    await settle(async () => { api.clearGenerationMismatch(); }); check(api.hydration === 'idle', 'clear failed');
    mismatch = false; await settle(async () => { api.retryLoad(); }); check(api.hydration === 'ready', 'reload failed');
  });
  await perform('unmount invalidates pending load and removes subscriptions', async () => {
    deferGet = true; await settle(async () => { api.retryLoad(); });
    const client = [...clients][0];
    await settle(async () => { root.unmount(); });
    const snapshot = client.getSnapshot(); const emits = counts.emits;
    await settle(async () => { if (!hold) throw new Error('missing in-flight GET'); hold(Response.json(body())); });
    check(counts.subscriptions === 0, 'leaked subscription');
    check(client.getSnapshot() === snapshot && counts.emits === emits, 'late response mutated store');
  });
  await perform('ready-at-mount survives StrictMode cancellation/replay', async () => {
    deferGet = false;
    const remount = createRoot(document.getElementById('mount')!);
    const before = counts.gets;
    await settle(async () => { remount.render(<StrictMode><Probe /></StrictMode>); });
    check(api.hydration === 'ready', 'StrictMode replay reused a disposed store');
    check(counts.gets > before && counts.gets <= before + 2, 'ready mount GET storm');
    const hydrated = counts.gets;
    await settle(async () => { remount.render(<StrictMode><Probe /></StrictMode>); });
    check(counts.gets === hydrated, 'ready remount rerender rehydrated');
    await settle(async () => { remount.unmount(); });
    check(counts.subscriptions === 0, 'remount leaked subscriptions');
  });
  check(failures.length === 0, 'React errors: ' + failures.join('; '));
}
void run().then(() => finish(true), error => finish(false, String(error)));
async function finish(ok: boolean, error?: string) {
  const result = { ok, error, results, checkpoints, counts, usedClientInstances: clients.size, clientInstancesCreated: constructedClients.size, errors: failures };
  document.getElementById('result')!.textContent = JSON.stringify(result, null, 2);
  await realFetch('/result', { method: 'POST', body: JSON.stringify(result) });
}
