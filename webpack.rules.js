module.exports = [
  // Native node modules (needed for the Recall SDK's binary components)
  {
    test: /native_modules[/\\].+\.node$/,
    use: "node-loader",
  },
  // TypeScript
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: "ts-loader",
      options: {
        transpileOnly: true,
      },
    },
  },
];
