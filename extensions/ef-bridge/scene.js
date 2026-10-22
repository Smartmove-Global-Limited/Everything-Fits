'use strict';
// Runs inside the editor scene process (engine `cc` available). `run` receives the body of an async
// function as a string, called with (cc, Editor); the return value must be JSON-serializable.
exports.load = function () { };
exports.unload = function () { };
async function run(code) {
  const cc = require('cc');
  const fn = new Function('cc', 'Editor', `return (async () => { ${code} })();`);
  const out = await fn(cc, typeof Editor !== 'undefined' ? Editor : undefined);
  try { return JSON.parse(JSON.stringify(out === undefined ? null : out)); } catch { return String(out); }
}
exports.methods = { run, chay: run };
