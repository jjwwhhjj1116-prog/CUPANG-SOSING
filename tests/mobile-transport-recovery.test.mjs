import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileTransport } from '../extensions/supplier-hub/mobile-transport.mjs';

const source = 'https://detail.1688.com/offer/90000000692.html';
const target = 'https://m.1688.com/offer/90000000692.html';
const runtimeId = 'a'.repeat(32);
const request = signal => ({ signal, method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const listeners = new Set(), calls = { checks: 0, reads: 0, updates: [], fetches: [] };
  let rules = [];
  const api = {
    runtime: { id: runtimeId },
    webRequest: { onHeadersReceived: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) } },
    declarativeNetRequest: {
      getSessionRules: async () => { calls.reads++; return structuredClone(rules); },
      updateSessionRules: async input => {
        calls.updates.push(structuredClone(input));
        rules = rules.filter(rule => !input.removeRuleIds.includes(rule.id)).concat(input.addRules);
      },
    },
  };
  const fetcher = async (url, init) => {
    calls.fetches.push({ url, credentials: init.credentials, redirect: init.redirect, cookie: init.headers.get('cookie') });
    return Response.json({ source: 'local fixture, no network request' });
  };
  return { api, calls, listeners, create: () => createMobileTransport(api, source, async () => { calls.checks++; }, fetcher),
    setRules: value => { rules = structuredClone(value); }, rules: () => structuredClone(rules) };
}

test('a later explicit capture rechecks a rejected preparation and successful preparation remains shared', async () => {
  const h = harness(), read = h.api.declarativeNetRequest.getSessionRules;
  h.api.declarativeNetRequest.getSessionRules = async () => {
    if (h.calls.reads === 0) { h.calls.reads++; throw Error('temporary Chrome service failure'); }
    return read();
  };
  const first = h.create();
  await assert.rejects(first(target, request(new AbortController().signal)), /temporary Chrome service failure/);
  assert.equal(h.calls.reads, 1); assert.equal(h.calls.fetches.length, 0); assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.calls.updates, []);
  await first.dispose();
  const second = h.create(), response = await second(target, request(new AbortController().signal));
  assert.equal(response.status, 200); assert.equal(h.calls.reads, 2); assert.equal(h.calls.fetches.length, 1);
  const third = h.create();
  await third(target, request(new AbortController().signal));
  assert.equal(h.calls.reads, 2); assert.equal(h.calls.fetches.length, 2);
  assert.ok(h.calls.fetches.every(call => call.url === target && call.credentials === 'omit' && call.redirect === 'manual' && call.cookie === null));
  await second.dispose(); await third.dispose();
});

test('concurrent failed captures share one failure; neither silently retries or fetches', async () => {
  const h = harness(), gate = deferred(), entered = deferred();
  h.api.declarativeNetRequest.getSessionRules = async () => { h.calls.reads++; entered.resolve(); return gate.promise; };
  const first = h.create(), second = h.create();
  const pending = Promise.allSettled([
    first(target, request(new AbortController().signal)), second(target, request(new AbortController().signal)),
  ]);
  await entered.promise;
  // Allow both callers to reach the shared pending preparation.
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.calls.reads, 1); gate.reject(Error('shared initialization failure'));
  const results = await pending;
  assert.ok(results.every(result => result.status === 'rejected' && /shared initialization failure/.test(result.reason.message)));
  assert.equal(h.calls.reads, 1); assert.equal(h.calls.fetches.length, 0); assert.equal(h.listeners.size, 0);
  h.api.declarativeNetRequest.getSessionRules = async () => { h.calls.reads++; return []; };
  const retry = h.create(); await retry(target, request(new AbortController().signal));
  assert.equal(h.calls.reads, 2); assert.equal(h.calls.fetches.length, 1);
  await first.dispose(); await second.dispose(); await retry.dispose();
});

test('failed startup cleanup stays closed until a later explicit capture rechecks and removes only owned stale rules', async () => {
  const h = harness(), stale = { id: 1000000012, condition: { initiatorDomains: [runtimeId] } },
    foreign = [{ id: 91, condition: { initiatorDomains: [runtimeId] } }, { id: 1000000013, condition: { initiatorDomains: ['b'.repeat(32)] } }];
  h.setRules([stale, ...foreign]);
  const update = h.api.declarativeNetRequest.updateSessionRules;
  let fail = true;
  h.api.declarativeNetRequest.updateSessionRules = async input => {
    if (fail) { fail = false; h.calls.updates.push(structuredClone(input)); throw Error('stale cleanup unavailable'); }
    return update(input);
  };
  const first = h.create();
  await assert.rejects(first(target, request(new AbortController().signal)), /stale cleanup unavailable/);
  assert.equal(h.calls.fetches.length, 0); assert.equal(h.calls.reads, 1);
  assert.deepEqual(h.rules(), [stale, ...foreign]);
  const second = h.create(); await second(target, request(new AbortController().signal));
  assert.equal(h.calls.reads, 2); assert.equal(h.calls.fetches.length, 1); assert.deepEqual(h.rules(), foreign);
  assert.deepEqual(h.calls.updates, [ { removeRuleIds: [stale.id], addRules: [] }, { removeRuleIds: [stale.id], addRules: [] } ]);
  await first.dispose(); await second.dispose();
});

test('an aborted capture after initialization failure cannot start a replacement preparation', async () => {
  const h = harness();
  h.api.declarativeNetRequest.getSessionRules = async () => { h.calls.reads++; throw Error('temporary failure'); };
  const transport = h.create();
  await assert.rejects(transport(target, request(new AbortController().signal)), /temporary failure/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(transport(target, request(aborted.signal)), /취소/);
  assert.equal(h.calls.reads, 1); assert.equal(h.calls.fetches.length, 0); assert.equal(h.listeners.size, 0);
  await transport.dispose();
});

test('concurrent successful captures initialize once and retain the existing anonymous request conditions', async () => {
  const h = harness(), gate = deferred(), entered = deferred();
  h.api.declarativeNetRequest.getSessionRules = async () => { h.calls.reads++; entered.resolve(); return gate.promise; };
  const first = h.create(), second = h.create();
  const pending = Promise.all([first(target, request(new AbortController().signal)), second(target, request(new AbortController().signal))]);
  await entered.promise; assert.equal(h.calls.reads, 1); assert.equal(h.calls.fetches.length, 0); gate.resolve([]);
  const result = await pending;
  assert.ok(result.every(response => response.status === 200)); assert.equal(h.calls.reads, 1); assert.equal(h.calls.fetches.length, 2);
  assert.deepEqual(h.calls.updates, []); assert.equal(h.listeners.size, 0);
  await first.dispose(); await second.dispose();
});
