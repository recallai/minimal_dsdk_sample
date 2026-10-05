/**
 * chip-renderer.ts — Chip window UI logic
 *
 * This runs in the renderer process of the small tray chip window.
 * It receives state updates from main.ts via IPC and updates the DOM.
 */

import "./chip.css";
import type { ChipAppState } from "./types";

interface TranscriptEvent {
  type: string;
  data: any;
}

interface AutoHideProgress {
  active: boolean;
  totalMs: number;
  remainingMs: number;
}

// The ElectronAPI type is exposed by preload.ts via contextBridge.
// Each method maps to an IPC handler in main.ts that wraps the
// corresponding Recall SDK call (startRecording, stopRecording, etc.).
declare global {
  interface Window {
    electronAPI: {
      getState: () => Promise<ChipAppState>;
      startRecording: (useRawMedia: boolean) => Promise<void>;
      pauseRecording: () => Promise<void>;
      resumeRecording: () => Promise<void>;
      stopRecording: () => Promise<void>;
      openViewer: () => Promise<void>;
      requestRawMediaPermission: (permission: "teams-automation" | "browser-automation") => Promise<void>;
      sendChatMessage: (message: string) => Promise<void>;
      setSettingsOpen: (open: boolean) => Promise<void>;
      quitApp: () => Promise<void>;
      notifyRendererReady: () => void;
      setChipHovering: (hovering: boolean) => void;
      onStateUpdate: (callback: (state: ChipAppState) => void) => void;
      onTranscriptEvent: (callback: (event: TranscriptEvent) => void) => void;
      onAutoHideProgress: (callback: (progress: AutoHideProgress) => void) => void;
    };
  }
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const stateIdle = document.getElementById("state-idle")!;
const stateDetected = document.getElementById("state-detected")!;
const stateRecording = document.getElementById("state-recording")!;
const stateComplete = document.getElementById("state-complete")!;
const stateSettings = document.getElementById("state-settings")!;

const meetingTitle = document.getElementById("meeting-title")!;
const meetingPlatform = document.getElementById("meeting-platform")!;

const recordingIndicator = document.getElementById("recording-indicator")!;
const recordingStatusText = document.getElementById("recording-status-text")!;
const recordingDuration = document.getElementById("recording-duration")!;
const transcriptScroll = document.getElementById("transcript-scroll")!;
const autoHideBarWrap = document.getElementById("auto-hide-bar-wrap")!;
const autoHideBar = document.getElementById("auto-hide-bar")!;
const chipRoot = document.getElementById("chip")!;

const btnRecord = document.getElementById("btn-record") as HTMLButtonElement;
const btnPause = document.getElementById("btn-pause")!;
const btnResume = document.getElementById("btn-resume")!;
const btnStop = document.getElementById("btn-stop")!;
const btnViewRecording = document.getElementById("btn-view-recording")!;
const btnViewRecordingsIdle = document.getElementById("btn-view-recordings-idle")!;
const btnQuit = document.getElementById("btn-quit")!;
const btnSettings = document.getElementById("btn-settings")!;
const preferRawMedia = document.getElementById("prefer-raw-media") as HTMLInputElement;
const rawMediaAvailability = document.getElementById("raw-media-availability")!;
const captureMode = document.getElementById("capture-mode")!;
const teamsPermissionStatus = document.getElementById("teams-permission-status")!;
const browserPermissionStatus = document.getElementById("browser-permission-status")!;
const btnTeamsPermission = document.getElementById("btn-teams-permission") as HTMLButtonElement;
const btnBrowserPermission = document.getElementById("btn-browser-permission") as HTMLButtonElement;
const settingsError = document.getElementById("settings-error")!;
const recordError = document.getElementById("record-error")!;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatMessage = document.getElementById("chat-message") as HTMLInputElement;
const chatError = document.getElementById("chat-error")!;

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

let durationInterval: ReturnType<typeof setInterval> | null = null;
let lastState: ChipAppState | null = null;
let settingsOpen = false;
preferRawMedia.checked = localStorage.getItem("preferRawMedia") !== "false";

function stopDurationTimer() {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
}

function resetRecordButton() {
  btnRecord.textContent = "Start Recording";
  btnRecord.disabled = false;
}

/** Show exactly one state section, hide the others. */
function showState(state: "idle" | "detected" | "recording" | "complete" | "settings") {
  stateIdle.style.display = state === "idle" ? "flex" : "none";
  stateDetected.style.display = state === "detected" ? "flex" : "none";
  stateRecording.style.display = state === "recording" ? "flex" : "none";
  stateComplete.style.display = state === "complete" ? "flex" : "none";
  stateSettings.style.display = state === "settings" ? "flex" : "none";
}

/** Format milliseconds as MM:SS for the recording timer display. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatPlatformName(platform?: string): string {
  if (!platform) return "Meeting";
  return platform
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRecordingElapsedMs(state: ChipAppState): number {
  const activeSegmentMs =
    state.isRecording && !state.isPaused && state.recordingStartTime
      ? Date.now() - state.recordingStartTime
      : 0;
  return Math.max(0, state.recordingElapsedMs + activeSegmentMs);
}

/** Update the UI based on the current app state. */
function updateUI(state: ChipAppState) {
  lastState = state;
  const canSetUp = state.sdkReady && state.rawMediaDeviceSupported && !state.detectedMeeting && !state.isRecording;
  rawMediaAvailability.textContent = state.rawMediaDeviceSupported
    ? "Available on this Mac when enabled for your Recall.ai workspace. Actual capture mode is shown after recording starts."
    : "Raw Media requires an Apple Silicon Mac running macOS 13 or later. This device uses local capture.";
  teamsPermissionStatus.textContent = state.permissionStatuses["teams-automation"] || "Checking…";
  browserPermissionStatus.textContent = state.permissionStatuses["browser-automation"] || "Checking…";
  btnTeamsPermission.disabled = !canSetUp || state.permissionStatuses["teams-automation"] === "granted";
  btnBrowserPermission.disabled = !canSetUp || state.permissionStatuses["browser-automation"] === "granted";
  captureMode.textContent = state.rawMediaActive === true
    ? "Raw Media active"
    : state.rawMediaActive === false
      ? "Local capture active"
      : "Checking capture mode…";
  chatForm.style.display = state.isRecording && !state.isPaused && state.rawMediaActive === true ? "flex" : "none";

  if (state.isRecording && state.detectedMeeting) {
    showState("recording");

    // Update pause/resume buttons
    btnPause.style.display = state.isPaused ? "none" : "inline-block";
    btnResume.style.display = state.isPaused ? "inline-block" : "none";

    // Update recording indicator
    recordingIndicator.className = state.isPaused
      ? "recording-dot paused"
      : "recording-dot";
    recordingStatusText.textContent = state.isPaused ? "Paused" : "Recording";
    recordingDuration.textContent = formatElapsed(getRecordingElapsedMs(state));

    // Tick only while actively recording; paused state keeps a frozen value.
    if (!state.isPaused && !durationInterval) {
      durationInterval = setInterval(() => {
        if (!lastState) return;
        if (!lastState.isRecording || lastState.isPaused) {
          stopDurationTimer();
          return;
        }
        recordingDuration.textContent = formatElapsed(getRecordingElapsedMs(lastState));
      }, 1000);
    } else if (state.isPaused) {
      stopDurationTimer();
    }
  } else if (state.detectedMeeting) {
    showState("detected");
    stopDurationTimer();
    resetRecordButton();

    const platformName = formatPlatformName(state.detectedMeeting.platform);
    meetingPlatform.textContent = platformName;
    meetingTitle.textContent = state.detectedMeeting.title || "Meeting Detected!";
  } else {
    showState(state.lastRecordingEndedAt ? "complete" : "idle");
    stopDurationTimer();
  }
  if (settingsOpen) showState("settings");
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

btnRecord.addEventListener("click", async () => {
  recordError.textContent = "";
  btnRecord.textContent = "Starting...";
  btnRecord.disabled = true;
  try {
    await window.electronAPI.startRecording(preferRawMedia.checked);
  } catch (err) {
    console.error("Failed to start recording:", err);
    recordError.textContent = String(err);
    resetRecordButton();
  }
});

btnPause.addEventListener("click", () => window.electronAPI.pauseRecording());
btnResume.addEventListener("click", () => window.electronAPI.resumeRecording());

btnStop.addEventListener("click", async () => {
  await window.electronAPI.stopRecording();
  transcriptScroll.innerHTML = "";
});

btnViewRecording.addEventListener("click", () => window.electronAPI.openViewer());
btnViewRecordingsIdle.addEventListener("click", () => window.electronAPI.openViewer());
btnQuit.addEventListener("click", () => window.electronAPI.quitApp());

btnSettings.addEventListener("click", async () => {
  settingsOpen = !settingsOpen;
  btnSettings.textContent = settingsOpen ? "Back" : "Settings";
  await window.electronAPI.setSettingsOpen(settingsOpen);
  if (lastState) updateUI(lastState);
});

preferRawMedia.addEventListener("change", () => {
  localStorage.setItem("preferRawMedia", String(preferRawMedia.checked));
});

async function requestAutomation(permission: "teams-automation" | "browser-automation", button: HTMLButtonElement) {
  settingsError.textContent = "";
  button.disabled = true;
  try {
    await window.electronAPI.requestRawMediaPermission(permission);
  } catch (error) {
    settingsError.textContent = String(error);
  } finally {
    if (lastState) updateUI(lastState);
  }
}

btnTeamsPermission.addEventListener("click", () => requestAutomation("teams-automation", btnTeamsPermission));
btnBrowserPermission.addEventListener("click", () => requestAutomation("browser-automation", btnBrowserPermission));

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  chatError.textContent = "";
  const message = chatMessage.value.trim();
  if (!message) return;
  try {
    await window.electronAPI.sendChatMessage(message);
    chatMessage.value = "";
  } catch (error) {
    chatError.textContent = String(error);
  }
});

chipRoot.addEventListener("mouseenter", () => {
  window.electronAPI.setChipHovering(true);
});

chipRoot.addEventListener("mouseleave", () => {
  window.electronAPI.setChipHovering(false);
});

// ---------------------------------------------------------------------------
// Realtime transcript display
// ---------------------------------------------------------------------------

window.electronAPI.onTranscriptEvent((event) => {
  const parsed = extractTranscript(event.data);
  if (!parsed) return;
  const { speaker, text } = parsed;

  const line = document.createElement("div");
  line.className = "transcript-line";
  if (event.type.includes("partial")) {
    line.classList.add("partial");
  }

  if (speaker) {
    const speakerSpan = document.createElement("span");
    speakerSpan.className = "transcript-speaker";
    speakerSpan.textContent = speaker + ": ";
    line.appendChild(speakerSpan);
  }

  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  line.appendChild(textSpan);

  // Replace the previous partial line when a new partial or final arrives.
  const lastPartial = transcriptScroll.querySelector(".transcript-line.partial");
  if (lastPartial) lastPartial.remove();

  transcriptScroll.appendChild(line);
  transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
});

/**
 * Extract speaker and text from a Recall SDK realtime transcript event.
 *
 * The SDK delivers transcript data nested under a `data` key with
 * participant info and a words array.
 */
function extractTranscript(data: any): { speaker: string; text: string } | null {
  const segment = data?.data;
  if (!segment) return null;

  const speaker = segment.participant?.name || "Speaker";
  const words: any[] = segment.words || [];
  const text = words.map((w: any) => w.text).join(" ").trim();

  return text ? { speaker, text } : null;
}

// ---------------------------------------------------------------------------
// Init: get current state and listen for updates
// ---------------------------------------------------------------------------

window.electronAPI.getState().then((state) => {
  updateUI(state);
});

// Tell main that the renderer is fully loaded and ready for an immediate state push.
window.electronAPI.notifyRendererReady();

window.electronAPI.onStateUpdate((state) => {
  updateUI(state);
});

window.electronAPI.onAutoHideProgress((progress) => {
  if (!progress.active || progress.totalMs <= 0) {
    autoHideBarWrap.style.display = "none";
    autoHideBar.style.width = "100%";
    return;
  }

  autoHideBarWrap.style.display = "block";
  const ratio = Math.max(0, Math.min(1, progress.remainingMs / progress.totalMs));
  autoHideBar.style.width = `${ratio * 100}%`;
});
