const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');
const { withUniwindConfig } = require('uniwind/metro');

let config = getDefaultConfig(__dirname);

// Worklets bundle mode generates files in a hidden `.worklets` directory.
// Metro can miss new files there when using Watchman, so watch the package
// root directly and fall back to the Node watcher.
config.watchFolders.push(path.resolve(__dirname, 'node_modules/react-native-worklets'));
config.useWatchman = false;

config = getBundleModeMetroConfig(config);

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
