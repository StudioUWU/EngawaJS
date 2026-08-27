import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGAWA_EVENT_PROTOCOL,
  ENGAWA_EVENT_PROTOCOL_VERSION,
  disposeEngawaUIEvents,
  installEngawaUIEvents,
  isEngawaRuntimeAvailable,
} from "engawa";

class HostMessageEvent extends Event {
  constructor(detail) {
    super("engawa-message");
    this.detail = detail;
  }
}

class TestHost extends EventTarget {
  posted = [];
  microtaskCount = 0;
  timerId = 0;
  timers = new Map();
  engawa = {
    postMessage: (value) => {
      this.posted.push(value);
    },
  };

  queueMicrotask(callback) {
    this.microtaskCount += 1;
    queueMicrotask(callback);
  }

  setTimeout(callback) {
    this.timerId += 1;
    this.timers.set(this.timerId, callback);
    return this.timerId;
  }

  clearTimeout(timerId) {
    this.timers.delete(timerId);
  }

  runTimers() {
    const callbacks = [...this.timers.values()];
    this.timers.clear();
    for (const callback of callbacks) {
      callback();
    }
  }

  send(detail) {
    this.dispatchEvent(new HostMessageEvent(detail));
  }
}

const envelope = (channel, event, payload = null) => ({
  protocol: ENGAWA_EVENT_PROTOCOL,
  version: ENGAWA_EVENT_PROTOCOL_VERSION,
  channel,
  event,
  payload,
});

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("emits exact protocol envelopes", () => {
  const host = new TestHost();
  const events = installEngawaUIEvents(host);

  assert.equal(events, host.EngawaUIEvents);
  assert.equal(events.protocolVersion, 1);
  assert.equal(events.emit("page.ready"), true);
  assert.equal(events.gameplayTags.emit("UI.Inventory.Open", { slot: 3 }), true);
  assert.deepEqual(host.posted, [
    envelope("event", "page.ready"),
    envelope("gameplay-tag", "UI.Inventory.Open", { slot: 3 }),
  ]);
  assert.throws(() => events.emit(""), TypeError);
  assert.throws(() => events.emit("x".repeat(257)), TypeError);
  assert.throws(() => events.emit("bad\u0000name"), TypeError);
  assert.equal(isEngawaRuntimeAvailable(host), true);

  host.engawa = undefined;
  assert.equal(isEngawaRuntimeAvailable(host), false);
  assert.throws(() => events.emit("page.ready"), /bridge is not available/);
  assert.equal(disposeEngawaUIEvents(host), true);
  assert.equal(disposeEngawaUIEvents(host), false);
});

test("delivers stable asynchronous snapshots", async () => {
  const host = new TestHost();
  const events = installEngawaUIEvents(host);
  const calls = [];

  let removeSecond = () => false;
  events.addListener("menu.open", (payload, name) => {
    calls.push(["first", payload, name]);
    removeSecond();
  });
  removeSecond = events.addListener("menu.open", (payload, name) => {
    calls.push(["second", payload, name]);
  });

  let onceCalls = 0;
  events.once("menu.open", () => {
    onceCalls += 1;
  });
  host.send(envelope("event", "menu.open", { value: 1 }));
  host.send(envelope("event", "menu.open", { value: 2 }));
  assert.equal(calls.length, 0);
  await flushMicrotasks();

  assert.deepEqual(calls, [
    ["first", { value: 1 }, "menu.open"],
    ["second", { value: 1 }, "menu.open"],
    ["first", { value: 2 }, "menu.open"],
    ["second", { value: 2 }, "menu.open"],
  ]);
  assert.equal(onceCalls, 1);

  const tagNames = [];
  events.gameplayTags.addListener("ui.inventory.updated", (_payload, name) => {
    tagNames.push(name);
  });
  host.send(envelope("gameplay-tag", "UI.Inventory.Updated", true));
  await flushMicrotasks();
  assert.deepEqual(tagNames, ["UI.Inventory.Updated"]);
});

test("batches bursts into one microtask", async () => {
  const host = new TestHost();
  const events = installEngawaUIEvents(host);
  let calls = 0;
  events.addListener("frame", () => {
    calls += 1;
  });

  for (let index = 0; index < 100; index += 1) {
    host.send(envelope("event", "frame", index));
  }
  assert.equal(host.microtaskCount, 1);
  await flushMicrotasks();
  assert.equal(calls, 100);
});

test("isolates listener failures", async () => {
  const host = new TestHost();
  const events = installEngawaUIEvents(host);
  let delivered = false;
  events.addListener("failure", () => {
    throw new Error("listener failed");
  });
  events.addListener("failure", () => {
    delivered = true;
  });

  host.send(envelope("event", "failure"));
  await flushMicrotasks();
  assert.equal(delivered, true);
  assert.equal(host.timers.size, 1);
  assert.throws(() => host.runTimers(), /listener failed/);
});

test("supports promise event waits", async () => {
  const host = new TestHost();
  const events = installEngawaUIEvents(host);
  const pending = events.waitFor("response");
  host.send(envelope("event", "response", { ok: true }));
  assert.deepEqual(await pending, {
    eventName: "response",
    payload: { ok: true },
  });

  const controller = new AbortController();
  const aborted = events.waitFor("aborted", { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });

  const timedOut = events.waitFor("timeout", { timeoutMs: 10 });
  host.runTimers();
  await assert.rejects(timedOut, /Timed out waiting/);
  assert.throws(() => events.waitFor("bad-timeout", { timeoutMs: -1 }), RangeError);
});

test("protects renewed duplicate subscriptions", async () => {
  const host = new TestHost();
  const events = installEngawaUIEvents(host);
  let calls = 0;
  const listener = () => {
    calls += 1;
  };

  const first = events.addListener("duplicate", listener);
  const duplicate = events.addListener("duplicate", listener);
  assert.equal(first(), true);
  const renewed = events.addListener("duplicate", listener);
  assert.equal(duplicate(), false);
  host.send(envelope("event", "duplicate"));
  await flushMicrotasks();
  assert.equal(calls, 1);
  assert.equal(renewed(), true);
  assert.equal(renewed(), false);
});

test("disposes retained-window deliveries", async () => {
  const host = new TestHost();
  const oldEvents = installEngawaUIEvents(host);
  let oldCalls = 0;
  oldEvents.addListener("reload", () => {
    oldCalls += 1;
  });
  host.send(envelope("event", "reload"));

  const newEvents = installEngawaUIEvents(host);
  let newCalls = 0;
  newEvents.addListener("reload", () => {
    newCalls += 1;
  });
  await flushMicrotasks();
  assert.equal(oldCalls, 0);

  host.send(envelope("event", "reload"));
  host.send({ protocol: "other", version: 1, channel: "event", event: "reload" });
  host.send({ protocol: ENGAWA_EVENT_PROTOCOL, version: 2, channel: "event", event: "reload" });
  await flushMicrotasks();
  assert.equal(newCalls, 1);
});

test("installs the standalone browser build", async () => {
  const host = new TestHost();
  globalThis.window = host;
  try {
    await import(`../dist/engawa.global.js?test=${Date.now()}`);
    assert.equal(host.EngawaUIEvents.protocolVersion, 1);
    assert.equal(host.Engawa, undefined);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(host, "EngawaUIEvents"),
      {
        value: host.EngawaUIEvents,
        writable: false,
        enumerable: true,
        configurable: true,
      },
    );
  } finally {
    disposeEngawaUIEvents(host);
    delete globalThis.window;
  }
});
