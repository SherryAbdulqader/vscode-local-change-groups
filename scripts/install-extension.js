// Installs the .vsix that `npm run package` just built.
//
// The filename has the version in it, and vsce picks that up from package.json
// on its own. Naming it here as well meant three copies of "0.3.0" in the npm
// scripts, which drifted the moment anyone bumped the version and then quietly
// installed a stale build. So we read it from the one place that knows.

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { name, version } = require('../package.json');

const vsix = `dist/${name}-${version}.vsix`;
if (!existsSync(vsix)) {
  console.error(`${vsix} is not there. Run "npm run package" first.`);
  process.exit(1);
}

// shell: true because on Windows `code` is a .cmd wrapper.
execFileSync('code', ['--install-extension', vsix, '--force'], { stdio: 'inherit', shell: true });
