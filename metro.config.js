const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('lottie');

config.resolver.blockList = [
  /node_modules\/lucide-react-native\/dist\/esm\/icons\/clock-11\.js/
];

module.exports = config;
