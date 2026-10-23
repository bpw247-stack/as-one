// app.json holds the app's configuration. The demo build (EXPO_PUBLIC_DEMO=1)
// is published as a single self-contained web page, so it bundles every
// screen together instead of loading them on demand.
module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_DEMO !== '1') return config;
  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      plugin === 'expo-router' ? ['expo-router', { asyncRoutes: false, sitemap: false }] : plugin,
    ),
  };
};
