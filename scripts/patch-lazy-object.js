// Diagnose + fix `LazyObject` missing in ExpoModulesHostObject.mm.
//
// Expo SDK 55's expo-modules-core 3.x rewrite may have moved LazyObject's
// declaring header. The .mm still references LazyObject without importing
// it explicitly (relied on a transitive include that's no longer there).
// Find where `class LazyObject` is declared in expo-modules-core and add
// an explicit #import to the .mm if missing.

const fs = require('fs');
const path = require('path');

const nodeModules = path.resolve(__dirname, '..', 'node_modules');
const coreRoot = path.join(nodeModules, 'expo-modules-core');
const targetMm = path.join(coreRoot, 'ios', 'JS', 'ExpoModulesHostObject.mm');

if (!fs.existsSync(coreRoot)) {
  console.log('expo-modules-core not installed, skipping');
  process.exit(0);
}

// Walk expo-modules-core to find files declaring `class LazyObject`.
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && (p.endsWith('.h') || p.endsWith('.hpp'))) out.push(p);
  }
  return out;
}

const headers = walk(coreRoot);
console.log('TAMTAM: scanned', headers.length, 'headers under expo-modules-core');

const declarers = [];
for (const h of headers) {
  let s;
  try { s = fs.readFileSync(h, 'utf8'); } catch (e) { continue; }
  if (/\bclass\s+LazyObject\b/.test(s)) declarers.push(h);
}

console.log('TAMTAM: LazyObject declared in:');
for (const d of declarers) console.log('  ', d);

if (declarers.length === 0) {
  console.log('TAMTAM: ERROR - LazyObject not found anywhere in expo-modules-core. Upstream removed it.');
  process.exit(0);
}

if (!fs.existsSync(targetMm)) {
  console.log('TAMTAM:', targetMm, 'missing, nothing to patch');
  process.exit(0);
}

let mm = fs.readFileSync(targetMm, 'utf8');
console.log('TAMTAM: ExpoModulesHostObject.mm top imports:');
for (const line of mm.split('\n').slice(0, 30)) {
  if (line.startsWith('#')) console.log('  ', line);
}

const declHeader = declarers[0];
const headerName = path.basename(declHeader);

if (mm.includes(headerName)) {
  console.log('TAMTAM:', headerName, 'already referenced in .mm');
  process.exit(0);
}

const insertion = `#import "${headerName}"\n`;
mm = insertion + mm;
fs.writeFileSync(targetMm, mm);
console.log('TAMTAM: prepended #import "' + headerName + '" to ExpoModulesHostObject.mm');
