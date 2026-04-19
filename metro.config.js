const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');
const { withUniwindConfig } = require('uniwind/metro');

let config = getDefaultConfig(__dirname);

config.watchFolders.push(path.resolve(__dirname, 'node_modules/react-native-worklets/.worklets'));

const defaultResolver = config.resolver.resolveRequest;

config = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});

config = getBundleModeMetroConfig(config);

const bundleModeResolver = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('react-native-worklets/.worklets/')) {
    return bundleModeResolver(context, moduleName, platform);
  }

  return defaultResolver
    ? defaultResolver(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
