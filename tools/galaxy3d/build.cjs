/* Builds docs/js/vendor/galaxy3d.js (Three.js subset + galaxy.src.js, minified IIFE).
 * One-time setup in this folder:   npm init -y && npm i three esbuild
 * Then:                            node build.cjs
 * (node_modules is not committed; the built file in docs/js/vendor is.) */
const path = require('path');
require(process.env.GALAXY_NODE_MODULES ? path.join(process.env.GALAXY_NODE_MODULES, 'esbuild') : 'esbuild').build({
  entryPoints: [path.join(__dirname, 'galaxy.src.js')],
  outfile: path.join(__dirname, '..', '..', 'docs', 'js', 'vendor', 'galaxy3d.js'),
  bundle: true, minify: true, format: 'iife', target: ['es2019'], legalComments: 'none',
  nodePaths: [process.env.GALAXY_NODE_MODULES || path.join(__dirname, 'node_modules')],
}).then(() => console.log('built docs/js/vendor/galaxy3d.js')).catch(() => process.exit(1));
