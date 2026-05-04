module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // SDK 54: Reanimated v4 movió el plugin de worklets a react-native-worklets.
      // DEBE ir al final del array de plugins.
      'react-native-worklets/plugin',
    ],
  };
};

