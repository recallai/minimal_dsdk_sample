# Minimal Desktop Recorder Sample

A minimal meeting recorder built with the [Recall.ai Desktop Recording SDK](https://docs.recall.ai/docs/desktop-sdk).

It sits in your menu bar, automatically detects meetings on Zoom, Google Meet, and Microsoft Teams, and lets you record with one click. During recording you get a live transcript, and afterwards you can browse and replay recordings in a local viewer at `localhost:3131`.

## Demo
https://www.loom.com/share/41ea9e390a8a4dc9858849ca6d2ec55e

## Quick start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set your `RECALL_API_KEY` and `RECALL_REGION`. You can find these in your [Recall.ai dashboard](https://recall.ai).

3. **Run the app:**

   ```bash
   npm start
   ```

   The app will appear as an icon in your menu bar. Open a meeting in Zoom, Google Meet, or Teams and the chip will pop up to offer recording.

### macOS permissions

The first time you run the app, macOS will prompt for accessibility, microphone, and screen-capture permissions. All three are required for the SDK to function. During development, the permission will appear under the name of your terminal or IDE (e.g. Cursor, iTerm) rather than the app name.

If a permission is denied, you can grant it later in **System Settings > Privacy & Security**. See the [macOS Permissions](https://docs.recall.ai/docs/macos-permissions) docs for more detail.

## Project structure

The most important files for understanding the Desktop Recording SDK are `main.ts` and `server.ts`. The other files are primarily concentrated around Electron and UI setup. 

- **`electron/main.ts`** — SDK lifecycle: `init`, `requestPermission`, event listeners, and recording controls (`startRecording`, `pauseRecording`, `resumeRecording`, `stopRecording`, `shutdown`).

- **`electron/server.ts`** — Express server with a `POST /api/token` endpoint that creates a [Desktop SDK Upload](https://docs.recall.ai/reference/desktop_sdk_upload_create) with transcription and realtime config. Also serves the recording viewer UI.

## Packaging for distribution

You only need this when you're ready to ship to users. During development, `npm start` is all you need.

```bash
npm run make
```

This produces a `.app` (macOS) or installer (Windows) in `out/`. For distribution, your app must be **code-signed** on both macOS and Windows. On macOS, it must also be **notarized** — without notarization, macOS will silently refuse to grant permissions even if they appear enabled in System Settings. See [Publishing Your App](https://docs.recall.ai/docs/publishing-your-app) for full details.

## Troubleshooting

**App doesn't appear in menu bar** — Check the terminal for errors. The most common cause is a missing or invalid `RECALL_API_KEY`.

**"Port 3131 is in use"** — Another instance may be running. Check with `lsof -i :3131`, or set a different `PORT` in `.env`.

**Permissions not working on macOS** — Ensure the app is listed and enabled in **System Settings > Privacy & Security** for Accessibility, Microphone, and Screen Recording. Restart the app after granting permissions.

**Recording appears but has no video/transcript** — The recording may still be processing. Refresh the viewer after a minute. Check that `RECALL_API_KEY` and `RECALL_REGION` are correct.

**Meeting not detected** — Make sure you're in an active meeting in Zoom, Google Meet, or Teams. The SDK needs Accessibility permission to detect meeting windows.

## License

MIT
