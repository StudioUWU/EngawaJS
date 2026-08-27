import Engawa from "engawa";

window.addEventListener("DOMContentLoaded", () => {
  if (window.engawa) {
    Engawa.emit("vite.ready", { ready: true });
  }
});
