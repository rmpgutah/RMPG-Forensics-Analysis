/**
 * electron-builder afterSign hook — applies ad-hoc local signature.
 * Runs after electron-builder signing (skipped), before DMG creation.
 * Ad-hoc signing lets macOS accept the app after `xattr -cr` without notarization.
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  if (process.platform !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • afterSign: ad-hoc signing ${appPath}`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    console.log('  • afterSign: done');
  } catch (err) {
    console.error('  • afterSign: failed:', err.message);
  }
};
