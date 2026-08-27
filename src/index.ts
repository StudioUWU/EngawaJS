/** 
 * COPYRIGHT STUDIOUWU
 * 
 * EngawaUI asynchronous event facade. */

export const ENGAWA_EVENT_PROTOCOL = "engawaui.event" as const;
export const ENGAWA_EVENT_PROTOCOL_VERSION = 1 as const;

export type EngawaJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly EngawaJsonValue[]
  | { readonly [key: string]: EngawaJsonValue };

export type JsonValue = EngawaJsonValue;

export interface EngawaEventMap {
  readonly [eventName: string]: EngawaJsonValue;
}

export type EngawaEventListener<
  TPayload extends EngawaJsonValue = EngawaJsonValue,
> = (payload: TPayload, eventName: string) => void;

export type EngawaUnsubscribe = () => boolean;

export interface EngawaWaitOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface EngawaReceivedEvent<
  TPayload extends EngawaJsonValue = EngawaJsonValue,
> {
  readonly eventName: string;
  readonly payload: TPayload;
}

export interface EngawaEventEmitter<
  TEvents extends EngawaEventMap = EngawaEventMap,
> {
  <TName extends Extract<keyof TEvents, string>>(eventName: TName): true;
  <TName extends Extract<keyof TEvents, string>>(
    eventName: TName,
    payload: TEvents[TName],
  ): true;
}

export interface EngawaEventChannel<
  TEvents extends EngawaEventMap = EngawaEventMap,
> {
  readonly emit: EngawaEventEmitter<TEvents>;
  readonly addListener: <TName extends Extract<keyof TEvents, string>>(
    eventName: TName,
    listener: EngawaEventListener<TEvents[TName]>,
  ) => EngawaUnsubscribe;
  readonly once: <TName extends Extract<keyof TEvents, string>>(
    eventName: TName,
    listener: EngawaEventListener<TEvents[TName]>,
  ) => EngawaUnsubscribe;
  readonly removeListener: <TName extends Extract<keyof TEvents, string>>(
    eventName: TName,
    listener: EngawaEventListener<TEvents[TName]>,
  ) => boolean;
  readonly clearListeners: (
    eventName?: Extract<keyof TEvents, string>,
  ) => void;
  readonly waitFor: <TName extends Extract<keyof TEvents, string>>(
    eventName: TName,
    options?: EngawaWaitOptions,
  ) => Promise<EngawaReceivedEvent<TEvents[TName]>>;
}

export interface EngawaEventsFacade<
  TEvents extends EngawaEventMap = EngawaEventMap,
  TGameplayTagEvents extends EngawaEventMap = EngawaEventMap,
> extends EngawaEventChannel<TEvents> {
  readonly protocolVersion: typeof ENGAWA_EVENT_PROTOCOL_VERSION;
  readonly gameplayTags: EngawaEventChannel<TGameplayTagEvents>;
}

export interface EngawaEventEnvelope<
  TPayload extends EngawaJsonValue = EngawaJsonValue,
> {
  readonly [key: string]: EngawaJsonValue;
  readonly protocol: typeof ENGAWA_EVENT_PROTOCOL;
  readonly version: typeof ENGAWA_EVENT_PROTOCOL_VERSION;
  readonly channel: "event" | "gameplay-tag";
  readonly event: string;
  readonly payload: TPayload;
}

export interface EngawaPageBridge {
  readonly postMessage: (value: EngawaJsonValue) => void;
}

declare global {
  namespace EngawaUI {
    interface Events extends EngawaEventMap {}
    interface GameplayTagEvents extends EngawaEventMap {}
    type JSONValue = EngawaJsonValue;
    type Listener<
      TPayload extends EngawaJsonValue = EngawaJsonValue,
    > = EngawaEventListener<TPayload>;
    type Unsubscribe = EngawaUnsubscribe;
    type EventChannel<
      TEvents extends EngawaEventMap = EngawaEventMap,
    > = EngawaEventChannel<TEvents>;
    type EventEmitter<
      TEvents extends EngawaEventMap = EngawaEventMap,
    > = EngawaEventEmitter<TEvents>;
    type Facade = EngawaEventsFacade<Events, GameplayTagEvents>;
    type PageBridge = EngawaPageBridge;
    type MessageEvent = CustomEvent<EngawaJsonValue>;
  }

  interface Window {
    readonly engawa?: EngawaPageBridge;
    readonly EngawaUIEvents: EngawaUI.Facade;
  }

  interface WindowEventMap {
    "engawa-message": CustomEvent<EngawaJsonValue>;
  }

  var EngawaUIEvents: EngawaUI.Facade;
}

export type EngawaGlobal = Window & typeof globalThis;

type RuntimeListener = EngawaEventListener<EngawaJsonValue>;

interface ListenerBucket {
  readonly listeners: Set<RuntimeListener>;
  readonly tokens: WeakMap<RuntimeListener, number>;
}

interface Delivery {
  readonly listeners: readonly RuntimeListener[];
  readonly payload: EngawaJsonValue;
  readonly eventName: string;
}

interface DeliveryScheduler {
  enqueue(delivery: Delivery): void;
  dispose(): void;
}

interface ChannelRouter {
  readonly api: EngawaEventChannel;
  dispatch(eventName: string, payload: EngawaJsonValue): void;
  clear(): void;
}

interface InstalledState {
  readonly facade: EngawaUI.Facade;
  dispose(): void;
}

const STATE_KEY = "__engawaUIEventsState_v1";
const HOST_MESSAGE_EVENT = "engawa-message";
const EVENT_NAME_CONTROLS = /[\u0000-\u001f]/;
const hasOwn = Object.prototype.hasOwnProperty;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function requireEventName(eventName: unknown): string {
  if (typeof eventName !== "string" || eventName.length === 0) {
    throw new TypeError("EngawaUI event names must be non-empty strings.");
  }
  if (eventName.length > 256 || EVENT_NAME_CONTROLS.test(eventName)) {
    throw new TypeError(
      "EngawaUI event names must be at most 256 characters with no control characters.",
    );
  }
  return eventName;
}

function reportListenerError(target: EngawaGlobal, error: unknown): void {
  target.setTimeout(() => {
    throw error;
  }, 0);
}

function createDeliveryScheduler(target: EngawaGlobal): DeliveryScheduler {
  let pending: Delivery[] = [];
  let scheduled = false;
  let active = true;

  const flush = (): void => {
    if (!active) {
      pending = [];
      scheduled = false;
      return;
    }

    const batch = pending;
    pending = [];
    scheduled = false;

    for (let deliveryIndex = 0; deliveryIndex < batch.length; deliveryIndex += 1) {
      if (!active) {
        return;
      }
      const delivery = batch[deliveryIndex];
      if (!delivery) {
        continue;
      }
      for (
        let listenerIndex = 0;
        listenerIndex < delivery.listeners.length;
        listenerIndex += 1
      ) {
        const listener = delivery.listeners[listenerIndex];
        if (!listener) {
          continue;
        }
        try {
          listener(delivery.payload, delivery.eventName);
        } catch (error) {
          reportListenerError(target, error);
        }
      }
    }
  };

  return {
    enqueue(delivery): void {
      if (!active) {
        return;
      }
      pending.push(delivery);
      if (!scheduled) {
        scheduled = true;
        target.queueMicrotask(flush);
      }
    },
    dispose(): void {
      active = false;
      pending = [];
    },
  };
}

function createAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The event wait was aborted.", "AbortError");
}

function createChannel(
  target: EngawaGlobal,
  scheduler: DeliveryScheduler,
  channelName: "event" | "gameplay-tag",
  caseInsensitiveListeners: boolean,
): ChannelRouter {
  const buckets = new Map<string, ListenerBucket>();
  let nextToken = 1;

  const listenerKey = (eventName: string): string =>
    caseInsensitiveListeners ? eventName.toLowerCase() : eventName;

  function emit(eventName: string, payload?: EngawaJsonValue): true {
    const name = requireEventName(eventName);
    const bridge = target.engawa;
    if (!bridge || typeof bridge.postMessage !== "function") {
      throw new Error("The EngawaUI page bridge is not available.");
    }
    const envelope: EngawaEventEnvelope = {
      protocol: ENGAWA_EVENT_PROTOCOL,
      version: ENGAWA_EVENT_PROTOCOL_VERSION,
      channel: channelName,
      event: name,
      payload: arguments.length >= 2 ? (payload as EngawaJsonValue) : null,
    };
    bridge.postMessage(envelope);
    return true;
  }

  function addListener(eventName: string, listener: RuntimeListener): EngawaUnsubscribe {
    const name = requireEventName(eventName);
    if (typeof listener !== "function") {
      throw new TypeError("EngawaUI event listeners must be functions.");
    }
    const key = listenerKey(name);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        listeners: new Set<RuntimeListener>(),
        tokens: new WeakMap<RuntimeListener, number>(),
      };
      buckets.set(key, bucket);
    }

    let token = bucket.tokens.get(listener);
    if (!bucket.listeners.has(listener)) {
      token = nextToken;
      nextToken += 1;
      bucket.listeners.add(listener);
      bucket.tokens.set(listener, token);
    }

    const subscriptionToken = token as number;
    let subscribed = true;
    return (): boolean => {
      if (!subscribed) {
        return false;
      }
      subscribed = false;
      const current = buckets.get(key);
      if (
        !current ||
        current.tokens.get(listener) !== subscriptionToken ||
        !current.listeners.delete(listener)
      ) {
        return false;
      }
      if (current.listeners.size === 0) {
        buckets.delete(key);
      }
      return true;
    };
  }

  function once(eventName: string, listener: RuntimeListener): EngawaUnsubscribe {
    if (typeof listener !== "function") {
      throw new TypeError("EngawaUI event listeners must be functions.");
    }
    let fired = false;
    let unsubscribe: EngawaUnsubscribe = () => false;
    const oneTimeListener: RuntimeListener = (payload, name): void => {
      if (fired) {
        return;
      }
      fired = true;
      unsubscribe();
      listener(payload, name);
    };
    unsubscribe = addListener(eventName, oneTimeListener);
    return unsubscribe;
  }

  function removeListener(eventName: string, listener: RuntimeListener): boolean {
    const key = listenerKey(requireEventName(eventName));
    const bucket = buckets.get(key);
    if (!bucket || !bucket.listeners.delete(listener)) {
      return false;
    }
    if (bucket.listeners.size === 0) {
      buckets.delete(key);
    }
    return true;
  }

  function clearListeners(eventName?: string): void {
    if (eventName === undefined) {
      buckets.clear();
      return;
    }
    buckets.delete(listenerKey(requireEventName(eventName)));
  }

  function waitFor(
    eventName: string,
    options: EngawaWaitOptions = {},
  ): Promise<EngawaReceivedEvent> {
    const name = requireEventName(eventName);
    const timeoutMs = options.timeoutMs;
    if (
      timeoutMs !== undefined &&
      (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    ) {
      throw new RangeError("EngawaUI event timeouts must be finite and non-negative.");
    }
    if (options.signal?.aborted) {
      return Promise.reject(createAbortReason(options.signal));
    }

    return new Promise<EngawaReceivedEvent>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: number | undefined;
      let unsubscribe: EngawaUnsubscribe = () => false;

      const cleanup = (): void => {
        unsubscribe();
        if (timeoutHandle !== undefined) {
          target.clearTimeout(timeoutHandle);
        }
        options.signal?.removeEventListener("abort", abort);
      };

      const finish = (
        callback: () => void,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };

      const abort = (): void => {
        finish(() => reject(createAbortReason(options.signal as AbortSignal)));
      };

      unsubscribe = addListener(name, (payload, deliveredName): void => {
        finish(() => resolve({ eventName: deliveredName, payload }));
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (timeoutMs !== undefined) {
        timeoutHandle = target.setTimeout(() => {
          finish(() => reject(new Error(`Timed out waiting for EngawaUI event "${name}".`)));
        }, timeoutMs);
      }
    });
  }

  const api = Object.freeze({
    emit,
    addListener,
    once,
    removeListener,
    clearListeners,
    waitFor,
  }) as unknown as EngawaEventChannel;

  return {
    api,
    dispatch(eventName, payload): void {
      const bucket = buckets.get(listenerKey(eventName));
      if (!bucket || bucket.listeners.size === 0) {
        return;
      }
      const listeners = new Array<RuntimeListener>(bucket.listeners.size);
      let index = 0;
      for (const listener of bucket.listeners) {
        listeners[index] = listener;
        index += 1;
      }
      scheduler.enqueue({ listeners, payload, eventName });
    },
    clear(): void {
      buckets.clear();
    },
  };
}

function createInstalledState(target: EngawaGlobal): InstalledState {
  const scheduler = createDeliveryScheduler(target);
  const simpleEvents = createChannel(target, scheduler, "event", false);
  const gameplayTagEvents = createChannel(target, scheduler, "gameplay-tag", true);

  const handleHostMessage = (domEvent: Event): void => {
    const envelope = (domEvent as CustomEvent<unknown>).detail;
    if (
      !isRecord(envelope) ||
      envelope["protocol"] !== ENGAWA_EVENT_PROTOCOL ||
      envelope["version"] !== ENGAWA_EVENT_PROTOCOL_VERSION ||
      typeof envelope["event"] !== "string"
    ) {
      return;
    }

    const payload = hasOwn.call(envelope, "payload")
      ? (envelope["payload"] as EngawaJsonValue)
      : null;
    if (envelope["channel"] === "event") {
      simpleEvents.dispatch(envelope["event"], payload);
    } else if (envelope["channel"] === "gameplay-tag") {
      gameplayTagEvents.dispatch(envelope["event"], payload);
    }
  };

  target.addEventListener(HOST_MESSAGE_EVENT, handleHostMessage);
  let disposed = false;
  const facade = Object.freeze({
    protocolVersion: ENGAWA_EVENT_PROTOCOL_VERSION,
    emit: simpleEvents.api.emit,
    addListener: simpleEvents.api.addListener,
    once: simpleEvents.api.once,
    removeListener: simpleEvents.api.removeListener,
    clearListeners: simpleEvents.api.clearListeners,
    waitFor: simpleEvents.api.waitFor,
    gameplayTags: gameplayTagEvents.api,
  }) as EngawaUI.Facade;

  return {
    facade,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      target.removeEventListener(HOST_MESSAGE_EVENT, handleHostMessage);
      scheduler.dispose();
      simpleEvents.clear();
      gameplayTagEvents.clear();
    },
  };
}

function getBrowserTarget(): EngawaGlobal | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function requireBrowserTarget(): EngawaGlobal {
  const target = getBrowserTarget();
  if (!target) {
    throw new Error("Engawa requires a browser Window.");
  }
  return target;
}

function getInstalledState(target: EngawaGlobal): InstalledState | undefined {
  const candidate = (target as unknown as Record<string, unknown>)[STATE_KEY];
  return isRecord(candidate) && typeof candidate["dispose"] === "function"
    ? (candidate as unknown as InstalledState)
    : undefined;
}

function createUnavailableFacade(): EngawaUI.Facade {
  const unavailable = (): never => {
    throw new Error("Engawa requires a browser Window.");
  };
  const channel = Object.freeze({
    emit: unavailable,
    addListener: unavailable,
    once: unavailable,
    removeListener: unavailable,
    clearListeners: unavailable,
    waitFor: (): Promise<never> => Promise.reject(new Error("Engawa requires a browser Window.")),
  }) as unknown as EngawaEventChannel;
  return Object.freeze({
    protocolVersion: ENGAWA_EVENT_PROTOCOL_VERSION,
    emit: channel.emit,
    addListener: channel.addListener,
    once: channel.once,
    removeListener: channel.removeListener,
    clearListeners: channel.clearListeners,
    waitFor: channel.waitFor,
    gameplayTags: channel,
  }) as EngawaUI.Facade;
}

/** Installs the global event facade. */
export function installEngawaUIEvents(
  target: EngawaGlobal = requireBrowserTarget(),
): EngawaUI.Facade {
  const record = target as unknown as Record<string, unknown>;
  getInstalledState(target)?.dispose();
  const state = createInstalledState(target);

  try {
    Object.defineProperty(target, STATE_KEY, {
      value: state,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    Object.defineProperty(target, "EngawaUIEvents", {
      value: state.facade,
      writable: false,
      configurable: true,
      enumerable: true,
    });
  } catch (error) {
    state.dispose();
    if (record[STATE_KEY] === state) {
      Reflect.deleteProperty(record, STATE_KEY);
    }
    throw error;
  }

  return state.facade;
}

/** Removes the global event facade. */
export function disposeEngawaUIEvents(target?: EngawaGlobal): boolean {
  const resolvedTarget = target ?? getBrowserTarget();
  if (!resolvedTarget) {
    return false;
  }
  const state = getInstalledState(resolvedTarget);
  if (!state) {
    return false;
  }
  state.dispose();
  const record = resolvedTarget as unknown as Record<string, unknown>;
  if (record[STATE_KEY] === state) {
    Reflect.deleteProperty(record, STATE_KEY);
  }
  Reflect.deleteProperty(record, "EngawaUIEvents");
  return true;
}

/** Checks the runtime bridge. */
export function isEngawaRuntimeAvailable(target?: EngawaGlobal): boolean {
  const resolvedTarget = target ?? getBrowserTarget();
  return Boolean(
    resolvedTarget?.engawa &&
    typeof resolvedTarget.engawa.postMessage === "function",
  );
}

const initialTarget = getBrowserTarget();

export const EngawaUIEvents: EngawaUI.Facade = initialTarget
  ? installEngawaUIEvents(initialTarget)
  : createUnavailableFacade();

export { EngawaUIEvents as Engawa };
export default EngawaUIEvents;
