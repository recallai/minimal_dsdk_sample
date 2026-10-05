const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    asar: {
      // The Recall SDK contains native binaries that must live outside the asar archive.
      // Without this, the SDK will fail to load at runtime.
      unpackDir: "node_modules/@recallai",
    },
    osxSign: {
      continueOnError: false,
      optionsForFile: (_) => ({
        entitlements: "./Entitlements.plist",
      }),
    },
    extendInfo: {
      NSUserNotificationAlertStyle: "alert",
      NSMicrophoneUsageDescription: "Record your voice during meetings.",
      NSAudioCaptureUsageDescription: "Record meeting audio for playback and transcription.",
      NSAppleEventsUsageDescription:
        "Allow this app to prepare supported meeting applications for high-quality recording.",
    },
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-dmg" },
    { name: "@electron-forge/maker-squirrel", config: {} },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    {
      name: "@electron-forge/plugin-webpack",
      config: {
        devContentSecurityPolicy:
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
        mainConfig: "./webpack.main.config.js",
        renderer: {
          config: "./webpack.renderer.config.js",
          entryPoints: [
            {
              html: "./electron/chip.html",
              js: "./electron/chip-renderer.ts",
              name: "tray_window",
              preload: {
                js: "./electron/preload.ts",
              },
            },
          ],
        },
      },
    },
    {
      // The Recall SDK is a native Node module and must be excluded from webpack
      // bundling. This plugin ensures it stays as a require('...') at runtime.
      name: "@timfish/forge-externals-plugin",
      config: {
        externals: ["@recallai/desktop-sdk"],
        includeDeps: true,
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
