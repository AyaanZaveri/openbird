module.exports = function (api) {
  api.cache(true);

  const workletsPluginOptions = {
    bundleMode: true,
    workletizableModules: ['remend'],
  };

  return {
    presets: [['babel-preset-expo']],
    plugins: [['react-native-worklets/plugin', workletsPluginOptions]],
  };
};
