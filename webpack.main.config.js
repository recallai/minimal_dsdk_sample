const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: "./electron/main.ts",
  module: {
    rules: require("./webpack.rules.js"),
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"],
  },
  plugins: [
    // Copy the viewer static files so server.ts can serve them at runtime.
    // They end up next to the webpack output in .webpack/main/viewer/
    new CopyPlugin({
      patterns: [
        { from: "viewer", to: "viewer" },
        { from: "electron/tray-icon.png", to: "tray-icon.png" },
      ],
    }),
  ],
  // The Recall SDK must be loaded as a native module at runtime, not bundled.
  externals: {
    "@recallai/desktop-sdk": "commonjs @recallai/desktop-sdk",
  },
};
