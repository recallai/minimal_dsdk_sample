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

### Optional Raw Media

[Raw Media](https://docs.recall.ai/docs/desktop-recording-sdk-raw-media) is a stable, opt-in Recall.ai workspace feature. Ask your Recall.ai account team to enable it. It supports Microsoft Teams Desktop and Google Meet in Chrome, Arc, Brave, Comet, or Dia on Apple Silicon Macs running macOS 13 or later. Make a supported browser your default before setting up Google Meet. Windows and unsupported meetings continue to use local capture.

Raw Media recordings are billed at meeting bot rates.

Open the tray chip's **Settings** before joining a meeting. Choose **Enable Teams** or **Enable Meet** to request the corresponding macOS Automation permission. macOS may ask to let the app control Teams or your browser; the application may restart once and restore its session. The settings view shows each permission's reported status. If access is denied, use **System Settings > Privacy & Security > Automation**, then retry setup. Standard accessibility, microphone, and screen-capture permissions remain necessary for local fallback.

**Prefer Raw Media when available** is on by default. Clear it to force local capture for the next recording. The SDK chooses the capture method at recording start; the recording view reports **Raw Media active** or **Local capture active** from the `recording-started.rawMedia` event. Permission status and device compatibility alone cannot confirm workspace enablement or predict whether a particular meeting will use Raw Media. Meeting chat is available in the chip only while a Raw Media recording is active.

To request separate participant raw audio artifacts for Raw Media recordings, set `RECALL_ENABLE_SEPARATE_AUDIO=true` in `.env`. This has no effect for recordings that fall back to local capture. The sample does not download or store these artifacts locally.

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

## Other Desktop Recording Resources
If you want to learn more about [recording system audio programmatically](https://www.recall.ai/blog/how-to-access-to-system-audio) we've also written a blog on covering accessing system audio in multiple ways with demos. If you're just interested in [macOS screen capture APIs](https://www.recall.ai/blog/macos-screencapture-api) there is a guide on all of the APIs to record on macOS. For those interested in Granola.ai, we've also put out a blog on open source [Granola.ai alternatives](https://www.recall.ai/blog/granola-ai-alternatives) and a tutorial on how to [build a meeting notetaker like granola](https://www.recall.ai/blog/how-to-build-a-desktop-recording-app). Finally, if you are interested in building a desktop recorder from scratch without Recall.ai, read the blog post on building a [botless recorder](https://www.recall.ai/blog/how-i-built-a-botless-meeting-recorder-from-scratch).

## License

MIT
