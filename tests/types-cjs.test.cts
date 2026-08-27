import EngawaPackage = require("engawa");

const Engawa = EngawaPackage.default;
const version: 1 = Engawa.protocolVersion;
const installed = EngawaPackage.installEngawaUIEvents(window);

void version;
void installed;
