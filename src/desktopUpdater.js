import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

const isTauriDesktop = Boolean(window.__TAURI__)
  && !/Android/i.test(navigator.userAgent)
  && !import.meta.env.DEV;

function versionOf(update) {
  return String(update?.version || "").replace(/^v/i, "");
}

function createTauriUpdater() {
  let currentUpdate = null;
  let downloadedBytes = 0;
  let contentLength = 0;
  const listeners = new Set();

  function emit(payload) {
    listeners.forEach((listener) => listener(payload));
  }

  function updatePayload(state, extra = {}) {
    return { state, version: versionOf(currentUpdate), releaseDate: currentUpdate?.date, ...extra };
  }

  return {
    onStatus(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    async checkForUpdates() {
      emit({ state: "checking" });
      currentUpdate = await check();
      if (!currentUpdate) {
        const payload = { state: "not-available" };
        emit(payload);
        return payload;
      }
      const payload = updatePayload("available");
      emit(payload);
      return payload;
    },

    async downloadUpdate() {
      if (!currentUpdate) {
        throw new Error("没有可下载的更新");
      }
      downloadedBytes = 0;
      contentLength = 0;
      emit(updatePayload("downloading", { percent: 0 }));
      await currentUpdate.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
        }
        const percent = contentLength
          ? Math.round((downloadedBytes / contentLength) * 100)
          : 0;
        emit(updatePayload(event.event === "Finished" ? "downloaded" : "downloading", {
          percent: Math.min(percent, 100),
          transferred: downloadedBytes,
          total: contentLength || undefined,
        }));
      });
      const payload = updatePayload("downloaded", { percent: 100 });
      emit(payload);
      return payload;
    },

    async installUpdate() {
      if (!currentUpdate) {
        throw new Error("没有已下载的更新");
      }
      emit(updatePayload("installing"));
      await currentUpdate.install();
      await relaunch();
      return updatePayload("installing");
    },
  };
}

export const tauriUpdater = isTauriDesktop ? createTauriUpdater() : null;
