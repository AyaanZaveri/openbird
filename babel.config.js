const workletsPluginOptions = {
  bundleMode: true,
  strictGlobal: true,
  workletizableModules: ['remend'],
};

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo']],
    plugins: [['react-native-worklets/plugin', workletsPluginOptions]],
  };
};
