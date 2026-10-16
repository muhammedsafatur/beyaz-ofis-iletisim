import { contextBridge, ipcRenderer } from "electron";

// Renderer'a yalnızca açıkça tanımlanan API'ler verilir. Belirteç işlemleri ana süreçteki safeStorage'a gider.
contextBridge.exposeInMainWorld("beyazOfis", {
  platform: process.platform,
  tokens: {
    load: () => ipcRenderer.invoke("tokens:load"),
    save: (tokens: unknown) => ipcRenderer.invoke("tokens:save", tokens),
    clear: () => ipcRenderer.invoke("tokens:clear"),
  },
});
