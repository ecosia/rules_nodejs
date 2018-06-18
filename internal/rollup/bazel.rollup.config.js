const nodeResolve = require('rollup-plugin-node-resolve');
const sourcemaps = require('rollup-plugin-sourcemaps');
const isBuiltinModule = require('is-builtin-module');
const path = require('path');
const fs = require('fs');

const DEBUG = false;

const moduleMappings = TMPL_module_mappings;
const workspaceName = 'TMPL_workspace_name';
const rootDir = 'TMPL_rootDir';
const moduleDirectory = 'TMPL_node_modules_path';
const banner_file = TMPL_banner_file;
const stamp_data = TMPL_stamp_data;

if (DEBUG)
  console.error(`
Rollup: running with
  rootDir: ${rootDir}
  moduleMappings: ${JSON.stringify(moduleMappings)}
  cwd: ${process.cwd()}
`);


let banner = '';
if (banner_file) {
  banner = fs.readFileSync(banner_file, {encoding: 'utf-8'});
  if (stamp_data) {
    const versionTag = fs.readFileSync(stamp_data, {encoding: 'utf-8'})
                           .split('\n')
                           .find(s => s.startsWith('BUILD_SCM_VERSION'));
    // Don't assume BUILD_SCM_VERSION exists
    if (versionTag) {
      const version = versionTag.split(' ')[1].trim();
      banner = banner.replace(/0.0.0-PLACEHOLDER/, version);
    }
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (e) {
    return false;
  }
}

// This resolver mimics the TypeScript Path Mapping feature, which lets us resolve
// modules based on a mapping of short names to paths.
function resolveBazel(
    importee, importer, baseDir = process.cwd(), resolve = require.resolve, root = rootDir) {
  function resolveInRootDir(importee) {
    var candidate = path.join(baseDir, root, importee);
    if (DEBUG) console.error(`Rollup: try to resolve '${importee}' at '${candidate}'`);
    try {
      var result = resolve(candidate);
      return result;
    } catch (e) {
      return undefined;
    }
  }

  // If import is fully qualified then resolve it directly
  if (fileExists(importee)) {
    if (DEBUG) console.error(`Rollup: resolved fully qualified '${importee}'`);
    return importee;
  }

  if (DEBUG) console.error(`Rollup: resolving '${importee}'`);

  // process.cwd() is the execroot and ends up looking something like
  // /.../2c2a834fcea131eff2d962ffe20e1c87/bazel-sandbox/872535243457386053/execroot/<workspace_name>
  // from that path to the es6 output is
  // <bin_dir_path>/<build_file_dirname>/<label_name>.es6 from there, sources
  // from the user's workspace are under <user_workspace_name>/<path_to_source>
  // and sources from external workspaces are under
  // <external_workspace_name>/<path_to_source>
  var resolved;
  if (importee.startsWith('.' + path.sep) || importee.startsWith('..' + path.sep)) {
    // relative import
    if (importer) {
      let importerRootRelative = path.dirname(importer);
      const relative = path.relative(path.join(baseDir, root), importerRootRelative);
      if (!relative.startsWith('.')) {
        importerRootRelative = relative;
      }
      resolved = path.join(importerRootRelative, importee);
    } else {
      throw new Error('cannot resolve relative paths without an importer');
    }
    if (resolved) resolved = resolveInRootDir(resolved);
  }

  if (!resolved) {
    // possible workspace import or external import if importee matches a module
    // mapping
    for (const k in moduleMappings) {
      if (importee == k || importee.startsWith(k + path.sep)) {
        // replace the root module name on a mappings match
        // note that the module_root attribute is intended to be used for type-checking
        // so it uses eg. "index.d.ts". At runtime, we have only index.js, so we strip the
        // .d.ts suffix and let node require.resolve do its thing.
        var v = moduleMappings[k].replace(/\.d\.ts$/, '');
        const mappedImportee = path.join(v, importee.slice(k.length + 1));
        if (DEBUG) console.error(`Rollup: module mapped '${importee}' to '${mappedImportee}'`);
        resolved = resolveInRootDir(mappedImportee);
        if (resolved) break;
      }
    }
  }

  if (!resolved) {
    // workspace import
    const userWorkspacePath = path.relative(workspaceName, importee);
    resolved = resolveInRootDir(userWorkspacePath.startsWith('..') ? importee : userWorkspacePath);
  }

  if (DEBUG && !resolved)
    console.error(`Rollup: allowing rollup to resolve '${importee}' with node module resolution`);

  return resolved;
}

function notResolved(importee, importer) {
  if (isBuiltinModule(importee)) {
    return null;
  }
  throw new Error(`Could not resolve import '${importee}' from '${importer}'`);
}

module.exports = {
  moduleDirectory,
  resolveBazel,
  notResolved,
  banner,
  onwarn: (warning) => {
    // Always fail on warnings, assuming we don't know which are harmless.
    // We can add exclusions here based on warning.code, if we discover some
    // types of warning should always be ignored under bazel.
    throw new Error(warning.message);
  },
  plugins: [TMPL_additional_plugins].concat([
    {resolveId: resolveBazel},
    nodeResolve({jsnext: true, module: true, customResolveOptions: {moduleDirectory}}),
    {resolveId: notResolved},
    sourcemaps(),
  ]),
};
