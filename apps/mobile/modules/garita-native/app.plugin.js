module.exports = function withGaritaNative(config) {
  config.android = config.android || {};
  config.android.permissions = [
    ...new Set([...(config.android.permissions || []), 'android.permission.SEND_SMS']),
  ];
  return config;
};
