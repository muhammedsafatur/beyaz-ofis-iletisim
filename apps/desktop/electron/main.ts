import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

// Geliştirmede Vite sunucusu, paketlenmiş sürümde dist klasörü yüklenir.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Oturum belirteçleri işletim sisteminin güvenli deposu ile şifrelenip kullanıcı klasöründe tutulur (§10).
// Güvenli depo yoksa belirteç kaydedilmez; uygulama her açılışta yeniden giriş ister.
const tokensFile = () => path.join(app.getPath("userData"), "tokens.bin");

function registerTokenHandlers() {
  ipcMain.handle("tokens:load", () => {
    const file = tokensFile();
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    } catch {
      return null;
    }
  });
  ipcMain.handle("tokens:save", (_event, tokens: unknown) => {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(tokensFile(), safeStorage.encryptString(JSON.stringify(tokens)));
  });
  ipcMain.handle("tokens:clear", () => {
    const file = tokensFile();
    if (fs.existsSync(file)) fs.rmSync(file);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

void app.whenReady().then(() => {
  registerTokenHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
