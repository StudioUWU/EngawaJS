# Engawa

Engawa is the event facade for EngawaUI and EngawaRuntime.

## Development

```powershell
npm install
```

## Install

```powershell
npm add engawa
```

## Vite usage

Importing the package installs `globalThis.EngawaUIEvents`

Example:

```ts
import Engawa from "engawa";

const unsubscribe = Engawa.addListener(
  "inventory.updated",
  (payload, eventName) => {
    console.log(eventName, payload);
  },
);

Engawa.emit("inventory.open", { slot: 3 });

const response = await Engawa.waitFor("inventory.response", {
  timeoutMs: 5000,
});

unsubscribe();
console.log(response.payload);
```

Gameplay Tag events use the case insensitive child channel:

```ts
Engawa.gameplayTags.emit("UI.Inventory.Open", { slot: 3 });

Engawa.gameplayTags.addListener("UI.Inventory.Updated", (payload) => {
  console.log(payload);
});
```

`emit` returns `true` after immediate bridge admission. It is intentionally
synchronous because the EngawaRuntime transport is asynchronous. Listener delivery is asynchronous and burst
messages share one channel.

## Global types

The declarations include the actual runtime and facade globals:

- `window.engawa.postMessage(value)`
- `globalThis.EngawaUIEvents`
- `window.addEventListener("engawa-message", handler)`
- the type-only `EngawaUI` namespace

Add application payload types through declaration merging:

```ts
declare global {
  namespace EngawaUI {
    interface Events {
      "inventory.updated": {
        itemId: string;
        count: number;
      };
    }

    interface GameplayTagEvents {
      "UI.Inventory.Open": {
        slot: number;
      };
    }
  }
}
```

## Browser script

The standalone browser build installs `EngawaUIEvents` without a bundler:

```html
<script src="node_modules/engawa/dist/engawa.global.js"></script>
<script>
  EngawaUIEvents.emit("page.ready", { ready: true });
</script>
```
