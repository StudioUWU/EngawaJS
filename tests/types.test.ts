import Engawa, {
  type EngawaEventEnvelope,
  type EngawaJsonValue,
  installEngawaUIEvents,
} from "engawa";

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

Engawa.emit("inventory.updated", { itemId: "potion", count: 2 });
Engawa.gameplayTags.emit("UI.Inventory.Open", { slot: 3 });
Engawa.addListener("inventory.updated", (payload, eventName) => {
  const count: number = payload.count;
  const name: string = eventName;
  void count;
  void name;
});

const pending = Engawa.waitFor("inventory.updated");
const installed = installEngawaUIEvents(window);
const facade: EngawaUI.Facade = installed;
const value: EngawaUI.JSONValue = { ready: true };
const bridge: EngawaUI.PageBridge | undefined = window.engawa;

window.addEventListener("engawa-message", (event) => {
  const detail: EngawaJsonValue = event.detail;
  void detail;
});

const message: EngawaEventEnvelope = {
  protocol: "engawaui.event",
  version: 1,
  channel: "event",
  event: "inventory.updated",
  payload: value,
};

globalThis.EngawaUIEvents.emit("inventory.updated", {
  itemId: "ether",
  count: 1,
});

void pending;
void facade;
void bridge;
void message;

// @ts-expect-error Typed payload is incomplete.
Engawa.emit("inventory.updated", { itemId: "potion" });

// @ts-expect-error Dates are not JSON values.
Engawa.emit("unknown.event", new Date());
