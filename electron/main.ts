/**
 * main.ts — Recall Desktop SDK integration
 *
 * This is the primary file to read for understanding how the SDK works.
 * It handles:
 *   - SDK initialization (init, permissions, event listeners)
 *   - Recording lifecycle (start, pause, resume, stop)
 *   - Meeting detection and deduplication
 *
 * The chip window UI (tray icon, popup, auto-hide) is in chip-window.ts.
 * Upload token creation and the recording viewer API are in server.ts.
 */

import { app, ipcMain } from "electron";
import RecallAiSdk from "@recallai/desktop-sdk";
import * as dotenv from "dotenv";
import * as chip from "./chip-window";
import { startServer } from "./server";
import { ChipAppState, MeetingWindow, mergeMeetingFields } from "./types";
import type { Server } from "http";

dotenv.config();

// Handle Squirrel install/update events on Windows (noop on macOS).
if (require("electron-squirrel-startup")) app.quit();

// Injected by Electron Forge's webpack plugin at build time.
declare const TRAY_WINDOW_WEBPACK_ENTRY: string;
declare const TRAY_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const SERVER_PORT = process.env.PORT || 3131;

// ---------------------------------------------------------------------------
// Recording state
// ---------------------------------------------------------------------------

let detectedMeeting: MeetingWindow | null = null;
let isRecording = false;
let isPaused = false;
let recordingStartTime: number | null = null;
let recordingElapsedMs = 0;
let lastRecordingEndedAt: number | null = null;
let lastMeetingClosedAt = 0;
let httpServer: Server | null = null;

function getChipState(): ChipAppState {
  return {
    detectedMeeting,
    isRecording,
    isPaused,
    recordingStartTime,
    recordingElapsedMs,
    lastRecordingEndedAt,
  };
}

function finalizeRecording(at = Date.now()) {
  if (recordingStartTime) {
    recordingElapsedMs += at - recordingStartTime;
  }
  recordingStartTime = null;
  lastRecordingEndedAt = at;
  isRecording = false;
  isPaused = false;
}

// ---------------------------------------------------------------------------
// Recording control IPC handlers
//
// These IPC handlers wrap the four core SDK recording methods:
//   startRecording()  — begin capturing a meeting window
//   pauseRecording()  — temporarily pause capture
//   resumeRecording() — resume a paused capture
//   stopRecording()   — end capture and trigger upload
//
// Each method takes a windowId (from the "meeting-detected" event).
// startRecording also requires an uploadToken from the Recall API
// (see server.ts POST /api/token for how this is created).
// ---------------------------------------------------------------------------

function bindIpcHandlers() {
  ipcMain.handle("start-recording", async () => {
    if (!detectedMeeting) throw new Error("No meeting detected");
    try {
      // Fetch an upload token from our local server. The server calls the
      // Recall API to create a Desktop SDK Upload with the desired
      // recording_config (transcription, realtime endpoints, etc.).
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/token`, { method: "POST" });
      const data = (await res.json()) as { upload_token?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `Token request failed with ${res.status}`);
      if (!data.upload_token) throw new Error("Token response missing upload_token");

      // Start recording the detected meeting window. The SDK captures
      // both audio and video and begins streaming realtime events.
      await RecallAiSdk.startRecording({
        windowId: detectedMeeting.id,
        uploadToken: data.upload_token,
      });

      chip.stopAutoHide();
      isRecording = true;
      isPaused = false;
      recordingStartTime = Date.now();
      recordingElapsedMs = 0;
      lastRecordingEndedAt = null;
      chip.sendState();
    } catch (error) {
      console.error("[Main] Failed to start recording:", error);
      throw error;
    }
  });

  ipcMain.handle("pause-recording", async () => {
    if (!detectedMeeting || !isRecording) return;
    try {
      await RecallAiSdk.pauseRecording({ windowId: detectedMeeting.id });
      if (recordingStartTime) {
        recordingElapsedMs += Date.now() - recordingStartTime;
        recordingStartTime = null;
      }
      isPaused = true;
      chip.sendState();
    } catch (error) {
      console.error("[Main] Failed to pause recording:", error);
      throw error;
    }
  });

  ipcMain.handle("resume-recording", async () => {
    if (!detectedMeeting || !isRecording) return;
    try {
      await RecallAiSdk.resumeRecording({ windowId: detectedMeeting.id });
      isPaused = false;
      recordingStartTime = Date.now();
      chip.sendState();
    } catch (error) {
      console.error("[Main] Failed to resume recording:", error);
      throw error;
    }
  });

  ipcMain.handle("stop-recording", async () => {
    if (!detectedMeeting || !isRecording) return;
    finalizeRecording();
    chip.sendState();
    try {
      // stopRecording triggers the upload automatically. The "recording-ended"
      // event will fire once the SDK confirms the recording has stopped.
      await RecallAiSdk.stopRecording({ windowId: detectedMeeting.id });
    } catch (error) {
      console.error("[Main] Failed to stop recording:", error);
      throw error;
    }
  });

  ipcMain.on("quit-app", () => {
    chip.setQuitting(true);
    app.quit();
  });
}

// ---------------------------------------------------------------------------
// Recall Desktop SDK lifecycle
//
// SDK lifecycle:
//   1. init()              — Initialize the DSDK
//   2. requestPermission() — Prompt macOS for accessibility/mic/screen-capture
//   3. addEventListener()  — Wire up event handlers for meeting detection,
//                            recording state, realtime transcript, and errors
//
// After init completes, the SDK automatically monitors for meeting windows
// (Zoom, Google Meet, Teams, Slack, etc.) and fires events when they appear,
// update, or close.
// ---------------------------------------------------------------------------

async function initSdk() {
  const region = process.env.RECALL_REGION || "us-east-1";
  const apiUrl = `https://${region}.recall.ai`;

  // Step 1: Initialize the SDK with the API URL for your region.
  // This must be called before any other SDK method.
  console.log("[SDK] Initializing with API URL:", apiUrl);
  await RecallAiSdk.init({ apiUrl });
  console.log("[SDK] init() completed successfully");

  // Step 2: Request macOS permissions. Each call triggers a system prompt if
  // the permission hasn't been granted yet. All three are required:
  //   - accessibility: detect meeting windows by title/URL
  //   - microphone:    capture meeting audio
  //   - screen-capture: capture the meeting window's video
  for (const permission of ["accessibility", "microphone", "screen-capture"] as const) {
    try {
      await RecallAiSdk.requestPermission(permission);
      console.log("[SDK] Permission granted/requested:", permission);
    } catch (error) {
      console.error("[SDK] Permission request failed:", permission, error);
    }
  }

  // Step 3: Register event listeners.
  //
  // The SDK fires events as meetings are detected, metadata updates, and
  // recordings produce data. These are the core events every integration
  // should handle.

  // "meeting-detected" fires when the SDK finds a new meeting window.
  // event.window contains { id, title, platform, url }. The id is the
  // window identifier you'll pass to startRecording().
  RecallAiSdk.addEventListener("meeting-detected", (event) => {
    console.log("[SDK] Meeting detected:", JSON.stringify(event.window));
    // Short cooldown after a meeting closes to suppress duplicate re-detections
    // (common with Google Meet, which can re-emit the same meeting immediately).
    if (Date.now() - lastMeetingClosedAt < 3000) return;
    detectedMeeting = event.window;
    chip.showForMeetingDetected(event.window.id, isRecording);
    chip.sendState();
  });

  // "meeting-updated" fires when metadata for a detected meeting changes
  // (e.g., title or URL becomes available after initial detection).
  RecallAiSdk.addEventListener("meeting-updated", (event) => {
    console.log("[SDK] Meeting updated:", JSON.stringify(event.window));
    if (detectedMeeting && detectedMeeting.id === event.window.id) {
      detectedMeeting = mergeMeetingFields(detectedMeeting, event.window);
      chip.sendState();
    }
  });

  // "meeting-closed" fires when a meeting window is closed. If a recording
  // was active, we finalize elapsed time and treat it as ended — the
  // "recording-ended" event should also fire, but if the window closes
  // abruptly the SDK may not emit it.
  RecallAiSdk.addEventListener("meeting-closed", (event) => {
    console.log("[SDK] Meeting closed:", event.window.id);
    if (detectedMeeting && detectedMeeting.id === event.window.id) {
      lastMeetingClosedAt = Date.now();
      detectedMeeting = null;
      chip.clearAutoPrompt(event.window.id);
      if (isRecording) {
        finalizeRecording();
      }
      chip.sendState();
    }
  });

  // "recording-ended" fires when a recording finishes (either because
  // stopRecording() was called, or the meeting ended during recording).
  // The SDK automatically uploads the recording at this point.
  RecallAiSdk.addEventListener("recording-ended", (event) => {
    console.log("[SDK] Recording ended for:", event.window.id);
    finalizeRecording();
    chip.sendState();
  });

  // "realtime-event" delivers live data during recording. The events you
  // receive depend on what you configured in the recording_config when
  // creating the upload token (see server.ts POST /api/token).
  // Here we listen for transcript.data (final) and transcript.partial_data
  // (in-progress) and forward them to the renderer for live display.
  RecallAiSdk.addEventListener("realtime-event", (event) => {
    if (event.event.startsWith("transcript.")) {
      chip.sendTranscriptEvent({ type: event.event, data: event.data });
    }
  });
  RecallAiSdk.addEventListener("error", (event) => {
    console.error("[SDK] Error:", event.type, event.message);
  });
  RecallAiSdk.addEventListener("permission-status", (event) => {
    console.log("[SDK] Permission status:", event.permission, "->", event.status);
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.on("ready", async () => {
  httpServer = startServer(SERVER_PORT);

  chip.initChipWindow({
    preloadEntry: TRAY_WINDOW_PRELOAD_WEBPACK_ENTRY,
    windowEntry: TRAY_WINDOW_WEBPACK_ENTRY,
    serverPort: SERVER_PORT,
    getState: getChipState,
  });

  bindIpcHandlers();

  // Initialize the Recall SDK after the UI is ready. This starts meeting
  // detection in the background — once a meeting window is found, the
  // "meeting-detected" event fires and we show the chip.
  try {
    await initSdk();
    console.log("[App] Recall SDK initialized successfully");
  } catch (error) {
    console.error("[App] Failed to initialize Recall SDK:", error);
  }
});

app.on("window-all-closed", () => {
  // Tray app stays active without open windows.
});

app.on("before-quit", async () => {
  chip.setQuitting(true);
  chip.dispose();
  httpServer?.close();
  // Always call shutdown() to release SDK resources and stop any active
  // recording. Safe to call even if init() was never completed.
  try {
    await RecallAiSdk.shutdown();
  } catch {
    // Ignore shutdown errors when SDK was not initialized.
  }
});
