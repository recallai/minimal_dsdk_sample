/**
 * preload.ts — IPC bridge between main and renderer
 *
 * Exposes a typed API to the tray chip renderer via contextBridge.
 * The renderer calls window.electronAPI.startRecording(), etc.
 * and these are forwarded to the main process via ipcRenderer.invoke().
 */

import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  // --- Recording controls ---
  getState: () => ipcRenderer.invoke("get-state"),
  startRecording: (useRawMedia: boolean) => ipcRenderer.invoke("start-recording", useRawMedia),
  pauseRecording: () => ipcRenderer.invoke("pause-recording"),
  resumeRecording: () => ipcRenderer.invoke("resume-recording"),
  stopRecording: () => ipcRenderer.invoke("stop-recording"),
  openViewer: () => ipcRenderer.invoke("open-viewer"),
  requestRawMediaPermission: (permission: "teams-automation" | "browser-automation") =>
    ipcRenderer.invoke("request-raw-media-permission", permission),
  sendChatMessage: (message: string) => ipcRenderer.invoke("send-chat-message", message),
  setSettingsOpen: (open: boolean) => ipcRenderer.invoke("set-settings-open", open),
  // Fire-and-forget via send() instead of invoke() so the renderer doesn't
  // block or throw if the main process is already shutting down.
  quitApp: () => {
    ipcRenderer.send("quit-app");
    return Promise.resolve();
  },

  // --- Events from main process ---
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on("state-update", (_event, state) => callback(state));
  },
  onTranscriptEvent: (callback: (event: any) => void) => {
    ipcRenderer.on("transcript-event", (_event, data) => callback(data));
  },
  onAutoHideProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on("auto-hide-progress", (_event, progress) => callback(progress));
  },

  // Renderer lifecycle signal so main can force a state sync after load.
  notifyRendererReady: () => {
    ipcRenderer.send("renderer-ready");
  },
  setChipHovering: (hovering: boolean) => {
    ipcRenderer.send("chip-hover-state", hovering);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
