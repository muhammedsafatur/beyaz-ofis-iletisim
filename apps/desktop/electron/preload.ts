import { contextBridge } from "electron";

// Renderer'a yalnızca açıkça tanımlanan API'ler verilir.
contextBridge.exposeInMainWorld("beyazOfis", {
  platform: process.platform,
});
