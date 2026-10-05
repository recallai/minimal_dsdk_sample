/**
 * chip-window.ts — Tray icon and chip popup window
 *
 * Manages the menu-bar tray icon and the small popup "chip" window that
 * appears when you click it or when a meeting is detected. This is all
 * Electron UI boilerplate — see main.ts for the SDK integration.
 */

import { BrowserWindow, nativeImage, Tray, screen, ipcMain, shell } from "electron";
import * as path from "path";
import type { ChipAppState } from "./types";

const CHIP_AUTO_HIDE_MS = 6000;
const CHIP_AUTO_HIDE_TICK_MS = 100;

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let quitting = false;
let hovered = false;
let autoHideInterval: ReturnType<typeof setInterval> | null = null;
let autoHideTotalMs = 0;
let autoHideRemainingMs = 0;
let lastAutoPromptMeetingId: string | null = null;
let getState: () => ChipAppState;

export function initChipWindow(config: {
  preloadEntry: string;
  windowEntry: string;
  serverPort: number | string;
  getState: () => ChipAppState;
}) {
  getState = config.getState;

  const icon = nativeImage.createFromPath(path.join(__dirname, "tray-icon.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Minimal Desktop Recorder Sample");
  tray.on("click", () => {
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
      return;
    }
    stopAutoHide();
    sendState();
    showNearTray();
  });

  win = new BrowserWindow({
    width: 380,
    height: 320,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#18181b",
    webPreferences: {
      preload: config.preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(config.windowEntry);
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win!.hide();
  });
  win.on("blur", () => {
    if (autoHideInterval) return;
    win!.hide();
  });
  win.on("hide", () => stopAutoHide());
  win.on("show", () => sendState());
  win.webContents.on("did-finish-load", () => sendState());

  ipcMain.handle("get-state", () => getState());
  ipcMain.on("renderer-ready", () => {
    sendState();
    emitAutoHideProgress();
  });
  ipcMain.on("chip-hover-state", (_event, isHovered: boolean) => {
    hovered = isHovered;
  });
  ipcMain.handle("open-viewer", () => {
    shell.openExternal(`http://localhost:${config.serverPort}`);
  });
  ipcMain.handle("set-settings-open", (_event, open: boolean) => {
    if (!win) return;
    if (open) stopAutoHide();
    win.setSize(380, open ? 440 : 320);
  });
}

export function sendState() {
  if (!win) return;
  win.webContents.send("state-update", getState());
}

export function sendTranscriptEvent(event: { type: string; data: any }) {
  win?.webContents.send("transcript-event", event);
}

export function showForMeetingDetected(meetingId: string, isRecording: boolean) {
  if (meetingId === lastAutoPromptMeetingId || isRecording) return;
  lastAutoPromptMeetingId = meetingId;
  showNearTray();
  startAutoHide();
}

export function clearAutoPrompt(meetingId: string) {
  if (lastAutoPromptMeetingId === meetingId) {
    lastAutoPromptMeetingId = null;
  }
}

export function stopAutoHide(notifyRenderer = true) {
  if (autoHideInterval) {
    clearInterval(autoHideInterval);
    autoHideInterval = null;
  }
  autoHideTotalMs = 0;
  autoHideRemainingMs = 0;
  if (notifyRenderer) {
    win?.webContents.send("auto-hide-progress", {
      active: false,
      totalMs: 0,
      remainingMs: 0,
    });
  }
}

export function setQuitting(value: boolean) {
  quitting = value;
}

export function dispose() {
  stopAutoHide(false);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function showNearTray() {
  if (!tray || !win) return;

  const trayBounds = tray.getBounds();
  const windowBounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height);
  win.setPosition(
    Math.max(
      display.workArea.x,
      Math.min(x, display.workArea.x + display.workArea.width - windowBounds.width)
    ),
    y
  );
  win.show();
}

function emitAutoHideProgress() {
  win?.webContents.send("auto-hide-progress", {
    active: Boolean(autoHideInterval),
    totalMs: autoHideTotalMs,
    remainingMs: Math.max(0, autoHideRemainingMs),
  });
}

function startAutoHide(totalMs = CHIP_AUTO_HIDE_MS) {
  if (!win || !win.isVisible()) return;

  stopAutoHide(false);
  autoHideTotalMs = totalMs;
  autoHideRemainingMs = totalMs;
  emitAutoHideProgress();

  autoHideInterval = setInterval(() => {
    if (!win || !win.isVisible()) {
      stopAutoHide();
      return;
    }

    if (hovered) {
      emitAutoHideProgress();
      return;
    }

    autoHideRemainingMs -= CHIP_AUTO_HIDE_TICK_MS;
    emitAutoHideProgress();
    if (autoHideRemainingMs <= 0) {
      win.hide();
      stopAutoHide();
    }
  }, CHIP_AUTO_HIDE_TICK_MS);
}
