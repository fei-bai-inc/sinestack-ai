import { checkReleaseVersion } from './version-policy.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/check-release-version.mjs <base-ref>');
  const { changed } = await checkReleaseVersion(process.argv[2]);
  console.log(`Release version policy passed. Changed packages: ${changed.map(pkg => `${pkg.name}@${pkg.version}`).join(', ') || '(none)'}.`);
} catch (error) {
  console.error(`Release version policy failed: ${error.message}`);
  process.exitCode = 1;
}
