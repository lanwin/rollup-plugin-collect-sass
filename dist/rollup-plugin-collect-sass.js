'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = _interopDefault(require('fs'));
var path = _interopDefault(require('path'));
var resolve = _interopDefault(require('resolve'));
var styleInject = _interopDefault(require('style-inject'));
var sass = _interopDefault(require('node-sass'));
var rollupPluginutils = require('rollup-pluginutils');
var mkdirp = _interopDefault(require('mkdirp'));

var START_COMMENT_FLAG = '/* collect-postcss-start';
var END_COMMENT_FLAG = 'collect-postcss-end */';
var ESCAPED_END_COMMENT_FLAG = 'collect-postcss-escaped-end * /';
var ESCAPED_END_COMMENT_REGEX = /collect-postcss-escaped-end \* \//g;

var escapeRegex = function (str) { return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); };

var findRegex = new RegExp(((escapeRegex(START_COMMENT_FLAG)) + "([^]*?)" + (escapeRegex(END_COMMENT_FLAG))), 'g');
var replaceRegex = new RegExp(((escapeRegex(START_COMMENT_FLAG)) + "[^]*?" + (escapeRegex(END_COMMENT_FLAG))));
var importRegex = new RegExp('@import([^;]*);', 'g');

var importExtensions = ['.scss', '.sass'];
var injectFnName = '__$styleInject';
var injectStyleFuncCode = styleInject
    .toString()
    .replace(/styleInject/, injectFnName);

var index = function (options) {
    if ( options === void 0 ) options = {};

    var extensions = options.extensions || importExtensions;
    var filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    var extract = Boolean(options.extract);
    var extractFn = typeof options.extract === 'function' ? options.extract : null;
    var extractPath = typeof options.extract === 'string' ? options.extract : null;
    var importOnce = Boolean(options.importOnce);

    var cssExtract = '';
    var visitedImports = new Set();

    return {
        name: 'collect-sass',
        intro: function intro () {
            if (extract) {
                return null
            }

            return injectStyleFuncCode
        },
        transform: function transform (code, id) {
            var this$1 = this;

            if (!filter(id)) { return null }
            if (extensions.indexOf(path.extname(id)) === -1) { return null }

            var relBase = path.dirname(id);
            var fileImports = new Set([id]);
            visitedImports.add(id);

            // Resolve imports before lossing relative file info
            // Find all import statements to replace
            var transformed = code.replace(importRegex, function (match, p1) {
                var paths = p1.split(/[,]/).map(function (p) {
                    var orgName = p.trim();  // strip whitespace
                    var name = orgName;

                    if (name[0] === name[name.length - 1] && (name[0] === '"' || name[0] === "'")) {
                        name = name.substring(1, name.length - 1);  // string quotes
                    }

                    // Exclude CSS @import: http://sass-lang.com/documentation/file.SASS_REFERENCE.html#import
                    if (path.extname(name) === '.css') { return orgName }
                    if (name.startsWith('http://')) { return orgName }
                    if (name.startsWith('url(')) { return orgName }

                    var fileName = path.basename(name);
                    var dirName = path.dirname(name);

                    // libsass's file name resolution: https://github.com/sass/node-sass/blob/1b9970a/src/libsass/src/file.cpp#L300
                    if (fs.existsSync(path.join(relBase, dirName, fileName))) {
                        var absPath = path.join(relBase, name);

                        if (importOnce && visitedImports.has(absPath)) {
                            return null
                        }

                        visitedImports.add(absPath);
                        fileImports.add(absPath);
                        return JSON.stringify(absPath)
                    }

                    if (fs.existsSync(path.join(relBase, dirName, ("_" + fileName)))) {
                        var absPath$1 = path.join(relBase, ("_" + name));

                        if (importOnce && visitedImports.has(absPath$1)) {
                            return null
                        }

                        visitedImports.add(absPath$1);
                        fileImports.add(absPath$1);
                        return JSON.stringify(absPath$1)
                    }

                    for (var i = 0; i < importExtensions.length; i += 1) {
                        var absPath$2 = path.join(relBase, dirName, ("_" + fileName + (importExtensions[i])));

                        if (fs.existsSync(absPath$2)) {
                            if (importOnce && visitedImports.has(absPath$2)) {
                                return null
                            }

                            visitedImports.add(absPath$2);
                            fileImports.add(absPath$2);
                            return JSON.stringify(absPath$2)
                        }
                    }

                    for (var i$1 = 0; i$1 < importExtensions.length; i$1 += 1) {
                        var absPath$3 = path.join(relBase, ("" + name + (importExtensions[i$1])));

                        if (fs.existsSync(absPath$3)) {
                            if (importOnce && visitedImports.has(absPath$3)) {
                                return null
                            }

                            visitedImports.add(absPath$3);
                            fileImports.add(absPath$3);
                            return JSON.stringify(absPath$3)
                        }
                    }

                    var nodeResolve;

                    try {
                        nodeResolve = resolve.sync(path.join(dirName, ("_" + fileName)), { extensions: extensions });
                    } catch (e) {} // eslint-disable-line no-empty

                    try {
                        nodeResolve = resolve.sync(path.join(dirName, fileName), { extensions: extensions });
                    } catch (e) {} // eslint-disable-line no-empty

                    if (nodeResolve) {
                        if (importOnce && visitedImports.has(nodeResolve)) {
                            return null
                        }

                        visitedImports.add(nodeResolve);
                        fileImports.add(nodeResolve);
                        return JSON.stringify(nodeResolve)
                    }

                    this$1.warn(("Unresolved path in " + id + ": " + name));

                    return orgName
                });

                var uniquePaths = paths.filter(function (p) { return p !== null; });

                if (uniquePaths.length) {
                    return ("@import " + (uniquePaths.join(', ')) + ";")
                }

                return ''
            });

            // Escape */ end comments
            transformed = transformed.replace(/\*\//g, ESCAPED_END_COMMENT_FLAG);

            // Add sass imports to bundle as JS comment blocks
            return {
                code: START_COMMENT_FLAG + transformed + END_COMMENT_FLAG,
                map: { mappings: '' },
                dependencies: Array.from(fileImports),
            }
        },
        transformBundle: function transformBundle (source) {
            // Reset paths
            visitedImports = new Set();

            // Extract each sass file from comment blocks
            var accum = '';
            var match = findRegex.exec(source);

            while (match !== null) {
                accum += match[1];
                match = findRegex.exec(source);
            }

            if (accum) {
                // Add */ end comments back
                accum = accum.replace(ESCAPED_END_COMMENT_REGEX, '*/');
                // Transform sass
                var css = sass.renderSync({
                    data: accum,
                    includePaths: ['node_modules'],
                }).css.toString();

                if (!extract) {
                    var injected = injectFnName + "(" + (JSON.stringify(css)) + ");";

                    // Replace first instance with output. Remove all other instances
                    return {
                        code: source.replace(replaceRegex, injected).replace(findRegex, ''),
                        map: { mappings: '' },
                    }
                }

                // Store css for writing
                cssExtract = css;
            }

            // Remove all other instances
            return {
                code: source.replace(findRegex, ''),
                map: { mappings: '' },
            }
        },
        onwrite: function onwrite (opts) {
            if (extract && cssExtract) {
                if (extractFn) { return extractFn(cssExtract, opts) }

                var destPath = extractPath ||
                    path.join(path.dirname(opts.dest), ((path.basename(opts.dest, path.extname(opts.dest))) + ".css"));

                return new Promise(function (resolveDir, rejectDir) {
                    mkdirp(path.dirname(destPath), function (err) {
                        if (err) { rejectDir(err); }
                        else { resolveDir(); }
                    });
                }).then(function () {
                    return new Promise(function (resolveExtract, rejectExtract) {

                        fs.writeFile(destPath, cssExtract, function (err) {
                            if (err) { rejectExtract(err); }
                            resolveExtract();
                        });
                    })
                })
            }

            return null
        },
    }
};

module.exports = index;
