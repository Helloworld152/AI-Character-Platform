const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

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

let backend = null;
let backendPid = null;
let mainWindow = null;
let isQuitting = false;

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
  await requestBackendShutdown();

  setTimeout(() => {
    if (backend === processToStop) {
      if (processToStop) {
        processToStop.kill();
      } else if (pidToStop) {
        try {
          process.kill(pidToStop);
        } catch (_) {
          return;
        }
      }
      backend = null;
      backendPid = null;
    }
  }, 1200);
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  await mainWindow.loadURL(rendererUrl);
}

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
