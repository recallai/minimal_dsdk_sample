export interface MeetingWindow {
  id: string;
  title?: string;
  platform?: string;
  url?: string;
}

export function mergeMeetingFields(existing: MeetingWindow, update: MeetingWindow): MeetingWindow {
  return {
    ...existing,
    title: update.title || existing.title,
    platform: update.platform || existing.platform,
    url: update.url || existing.url,
  };
}

export interface ChipAppState {
  detectedMeeting: MeetingWindow | null;
  isRecording: boolean;
  isPaused: boolean;
  recordingStartTime: number | null;
  recordingElapsedMs: number;
  lastRecordingEndedAt: number | null;
}
