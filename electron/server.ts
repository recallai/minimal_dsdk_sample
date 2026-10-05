/**
 * server.ts — Local Express server
 *
 * This server does two things:
 * 1. Token generation: Creates Recall SDK upload tokens with the right recording
 *    config (transcription provider, realtime endpoints). The Electron app calls
 *    this before starting each recording.
 * 2. Recording viewer: Serves a simple web UI for browsing past recordings and
 *    viewing their video + transcript. Proxies the Recall API so the viewer
 *    doesn't need the API key.
 */

import express from "express";
import axios from "axios";
import * as path from "path";

export function startServer(port: number | string) {
  const expressApp = express();

  const apiKey = process.env.RECALL_API_KEY || "";
  const apiUrl = `https://${process.env.RECALL_REGION || "us-east-1"}.recall.ai`;

  if (!apiKey) {
    console.error("[Server] RECALL_API_KEY is not set. Copy .env.example to .env and add your key.");
  }

  const recallApi = axios.create({
    baseURL: apiUrl,
    headers: { Authorization: `Token ${apiKey}` },
  });

  expressApp.use(express.json());

  // -------------------------------------------------------------------------
  // Token generation
  // -------------------------------------------------------------------------

  /**
   * POST /api/token
   *
   * Creates a new Desktop SDK Upload and returns the upload token.
   *
   * The recording_config here is the most important part of the SDK integration.
   * It tells Recall:
   * - Which transcription provider to use (recallai_streaming — no extra setup needed)
   * - Where to send realtime events (desktop_sdk_callback — delivers them directly
   *   to the SDK's 'realtime-event' listener in main.ts)
   * - Which events to stream (transcript.data for final segments,
   *   transcript.partial_data for in-progress words)
   */
  expressApp.post("/api/token", async (_req, res) => {
    try {
      const { data } = await recallApi.post("/api/v1/sdk_upload/", {
        recording_config: {
          // Separate participant audio is only produced when Raw Media is active.
          // It is ignored for local capture, and is opt-in to avoid extra artifacts.
          ...(process.env.RECALL_ENABLE_SEPARATE_AUDIO === "true"
            ? { audio_separate_raw: {} }
            : {}),
          // Enable transcription using Recall's built-in provider.
          // No additional API keys or external services needed.
          transcript: {
            provider: {
              recallai_streaming: {},
            },
          },

          // Deliver live transcript data back to the SDK in the Electron app.
          // The SDK will fire 'realtime-event' for each event listed here.
          realtime_endpoints: [
            {
              type: "desktop_sdk_callback",
              events: ["transcript.data", "transcript.partial_data"],
            },
          ],
        },
      });

      res.json({ upload_token: data.upload_token });
    } catch (err: any) {
      console.error("[Server] Token generation failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // Recording viewer API (Desktop SDK Uploads)
  // -------------------------------------------------------------------------

  /**
   * GET /api/recordings
   *
   * Lists all Desktop SDK uploads. This is the primary index for viewer pages.
   */
  expressApp.get("/api/recordings", async (_req, res) => {
    try {
      const { data } = await recallApi.get("/api/v1/sdk_upload/");
      const uploads = Array.isArray(data) ? data : data.results || [];

      res.json(
        uploads.map((upload: any) => ({
          id: upload.id,
          createdAt: upload.created_at,
          status: upload.status,
          recordingId: upload.recording_id || null,
          meetingTitle: upload.metadata?.title || null,
        }))
      );
    } catch (err: any) {
      console.error("[Server] Failed to list SDK uploads:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/recordings/:id
   *
   * Gets a single Desktop SDK upload. If it has a recording_id, we hydrate
   * media fields from the Recording endpoint so the viewer can play video and
   * show transcript.
   */
  expressApp.get("/api/recordings/:id", async (req, res) => {
    try {
      let transcript: any[] = [];
      let recording: any = null;

      const { data: upload } = await recallApi.get(`/api/v1/sdk_upload/${req.params.id}/`);
      const recordingId = upload.recording_id || null;

      if (recordingId) {
        const { data: rec } = await recallApi.get(`/api/v1/recording/${recordingId}/`);
        recording = rec;

        const transcriptUrl = recording.media_shortcuts?.transcript?.data?.download_url || null;
        if (transcriptUrl) {
          try {
            const { data: transcriptData } = await axios.get(transcriptUrl);
            transcript = transcriptData;
          } catch (err) {
            console.error("[Server] Failed to fetch transcript:", err);
          }
        }
      }

      res.json({
        id: upload.id,
        createdAt: upload.created_at,
        status: upload.status,
        recordingId,
        startedAt: recording?.started_at || null,
        completedAt: recording?.completed_at || null,
        videoUrl: recording?.media_shortcuts?.video_mixed?.data?.download_url || null,
        transcript,
        meetingTitle:
          recording?.media_shortcuts?.meeting_metadata?.data?.title ||
          upload.metadata?.title ||
          null,
      });
    } catch (err: any) {
      console.error("[Server] Failed to get SDK upload:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // Serve the recording viewer static files
  // -------------------------------------------------------------------------

  expressApp.use(express.static(path.join(__dirname, "viewer")));

  expressApp.get("/recording/:id", (_req, res) => {
    res.sendFile(path.join(__dirname, "viewer", "recording.html"));
  });

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  const server = expressApp.listen(port, () => {
    console.log(`[Server] Recording viewer at http://localhost:${port}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Server] Port ${port} is in use. Try setting a different PORT in .env.`);
      console.error("[Server] Note: Electron Forge's dev server uses port 3000 by default.");
    } else {
      console.error("[Server] Failed to start:", err);
    }
  });

  return server;
}
