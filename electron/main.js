const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const DATA_DIRECTORY_NAME = "ai-character-platform";
function resolveDataRoot() {
  const configured = String(process.env.AI_CHARACTER_DATA_DIR || "").trim();
  if (configured) {
    return path.resolve(configured);
  }

  const home = os.homedir();
  const base = process.platform === "darwin"
    ? path.join(home, "Library", "Application Support")
    : process.platform === "win32"
      ? process.env.APPDATA || path.join(home, "AppData", "Roaming")
      : process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, DATA_DIRECTORY_NAME);
}

const dataRoot = resolveDataRoot();
fs.mkdirSync(dataRoot, { recursive: true });
app.setPath("userData", dataRoot);
const isPackaged = app.isPackaged;
const root = isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked")
  : path.resolve(__dirname, "..");
const port = process.env.AI_CHARACTER_PORT || "8787";
const host = "127.0.0.1";
const url = `http://${host}:${port}`;
const rendererUrl = process.env.VITE_DEV_SERVER_URL || url;
const packagedBackend = process.platform === "win32"
  ? path.join(process.resourcesPath, "backend", "backend.exe")
  : null;
const CHARACTER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/;

let backend = null;
let backendPid = null;
let mainWindow = null;
let isQuitting = false;
let updateDownloaded = false;

autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = true;

function sendUpdateStatus(payload) {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("updater:status", payload);
}

function setupUpdater() {
  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    updateDownloaded = false;
    sendUpdateStatus({
      state: "available",
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    updateDownloaded = false;
    sendUpdateStatus({ state: "not-available", version: info.version });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      state: "downloading",
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateDownloaded = true;
    sendUpdateStatus({
      state: "downloaded",
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });
  autoUpdater.on("error", (error) => {
    sendUpdateStatus({ state: "error", message: error.message || String(error) });
  });
}

function setupUpdaterIpc() {
  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      return { state: "disabled", message: "更新检查仅在正式安装包中可用" };
    }
    sendUpdateStatus({ state: "checking" });
    await autoUpdater.checkForUpdates();
    return { state: "checking" };
  });

  ipcMain.handle("updater:download", async () => {
    if (!app.isPackaged) {
      return { state: "disabled", message: "更新下载仅在正式安装包中可用" };
    }
    await autoUpdater.downloadUpdate();
    return { state: "downloading" };
  });

  ipcMain.handle("updater:install", async () => {
    if (!updateDownloaded) {
      return { state: "error", message: "没有已下载的更新" };
    }
    isQuitting = true;
    await stopBackend();
    autoUpdater.quitAndInstall(false, true);
    return { state: "installing" };
  });

  ipcMain.handle("character:open-directory", async (_event, characterId) => {
    const normalizedId = String(characterId || "").trim();
    if (!CHARACTER_ID_RE.test(normalizedId)) {
      throw new Error("无效的角色 id");
    }

    const target = path.join(dataRoot, "characters", normalizedId);
    if (!fs.existsSync(target)) {
      throw new Error(`角色目录不存在: ${target}`);
    }

    shell.showItemInFolder(target);
    return { opened: true, path: target };
  });
}

function startBackend() {
  const usePackagedBackend = Boolean(isPackaged && packagedBackend);
  const command = usePackagedBackend
    ? packagedBackend
    : isPackaged && process.platform === "darwin"
      ? "/usr/bin/python3"
      : process.platform === "win32"
        ? "python"
        : "python3";
  const args = usePackagedBackend ? [] : ["web_server.py"];
  const cwd = usePackagedBackend ? process.resourcesPath : root;

  const backendEnv = {
    ...process.env,
    AI_CHARACTER_HOST: host,
    AI_CHARACTER_PORT: port,
    AI_CHARACTER_APP_ROOT: root,
    AI_CHARACTER_DATA_DIR: dataRoot,
  };

  backend = spawn(command, args, {
    cwd,
    env: backendEnv,
    stdio: isPackaged ? "ignore" : ["ignore", "pipe", "pipe"],
    detached: isPackaged,
    windowsHide: true,
  });
  backendPid = backend.pid;

  if (isPackaged) {
    backend.unref();
  }

  backend.on("exit", (code) => {
    backend = null;
    backendPid = null;
    if (!isQuitting && code !== 0 && mainWindow) {
      mainWindow.webContents.send("backend-exit", code);
    }
  });
}

function requestBackendShutdown() {
  return new Promise((resolve) => {
    if (!backend) {
      resolve();
      return;
    }

    const request = http.request(`${url}/api/shutdown`, { method: "POST", timeout: 800 }, (response) => {
      response.resume();
      resolve();
    });
    request.on("error", resolve);
    request.on("timeout", () => {
      request.destroy();
      resolve();
    });
    request.end();
  });
}

async function stopBackend() {
  if (!backend && !backendPid) {
    return;
  }

  const processToStop = backend;
  const pidToStop = backendPid;
  const waitForExit = processToStop
    ? new Promise((resolve) => {
        processToStop.once("exit", resolve);
      })
    : Promise.resolve();
  await requestBackendShutdown();

  const exited = await Promise.race([
    waitForExit.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
  ]);

  if (!exited) {
    if (processToStop) {
      processToStop.kill();
    } else if (pidToStop) {
      try {
        process.kill(pidToStop);
      } catch (_) {
        return;
      }
    }
    await Promise.race([
      waitForExit,
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
  }

  if (backend === processToStop) {
    backend = null;
    backendPid = null;
  }
}

function waitForBackend(attempt = 0) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}/api/health`, (response) => {
      response.resume();
      resolve();
    });
    request.on("error", () => {
      if (attempt >= 80) {
        reject(new Error("Python backend did not start"));
        return;
      }
      setTimeout(() => waitForBackend(attempt + 1).then(resolve, reject), 100);
    });
    request.setTimeout(800, () => {
      request.destroy();
    });
  });
}

async function createWindow() {
  startBackend();
  await waitForBackend();

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "AI Character Platform",
    backgroundColor: "#eef2ee",
    autoHideMenuBar: process.platform === "win32",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (process.platform === "win32") {
    mainWindow.setMenuBarVisibility(false);
  }

  await mainWindow.loadURL(rendererUrl);
}

setupUpdater();
setupUpdaterIpc();

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  isQuitting = true;
  await stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
    return;
  }
  app.quit();
});

app.on("before-quit", async (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  await stopBackend();
  app.quit();
});
