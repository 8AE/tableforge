exports.default = async function notarizeIfConfigured(context) {
  if (process.platform !== 'darwin') return;
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) return;

  const { notarize } = require('@electron/notarize');
  const appName = context.packager.appInfo.productFilename;

  await notarize({
    appBundleId: context.packager.appInfo.appId,
    appPath: `${context.appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
