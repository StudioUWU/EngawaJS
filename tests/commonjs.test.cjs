const assert = require("node:assert/strict");
const test = require("node:test");

const Engawa = require("engawa");

test("loads the CommonJS export", () => {
  assert.equal(Engawa.ENGAWA_EVENT_PROTOCOL, "engawaui.event");
  assert.equal(Engawa.ENGAWA_EVENT_PROTOCOL_VERSION, 1);
  assert.equal(typeof Engawa.installEngawaUIEvents, "function");
  assert.equal(Engawa.default.protocolVersion, 1);
});
