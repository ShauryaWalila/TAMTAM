// Patch expo-* Swift/ObjC sources that reference APIs removed in Expo SDK 55.
// The expo-modules-core rewrite dropped helpers like EXFatal,
// EXErrorWithMessage, EXSharedApplication. Older expo-* modules still call
// them at the source level; replace with Swift/ObjC equivalents so the build
// proceeds. Idempotent.

const fs = require('fs');
const path = require('path');

const nodeModulesRoot = path.resolve(__dirname, '..', 'node_modules');

if (!fs.existsSync(nodeModulesRoot)) {
  console.log('node_modules not found, skipping');
  process.exit(0);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      out.push(...walk(p));
    } else if (st.isFile() && (p.endsWith('.swift') || p.endsWith('.m') || p.endsWith('.mm'))) {
      out.push(p);
    }
  }
  return out;
}

// Walk only expo-* package directories.
const expoDirs = fs
  .readdirSync(nodeModulesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('expo-'))
  .map((d) => path.join(nodeModulesRoot, d.name));

const files = expoDirs.flatMap(walk);
console.log('TAMTAM: scanning', files.length, 'expo source files');

let touched = 0;

for (const file of files) {
  let s;
  try { s = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  const before = s;
  const isSwift = file.endsWith('.swift');

  if (isSwift) {
    // EXFatal(EXErrorWithMessage(<msg>)) -> fatalError(<msg>)
    s = s.replace(
      /EXFatal\s*\(\s*EXErrorWithMessage\s*\(([\s\S]*?)\)\s*\)/g,
      'fatalError($1)'
    );
    // Standalone EXFatal(<expr>) -> fatalError(String(describing: <expr>))
    s = s.replace(
      /\bEXFatal\s*\(([\s\S]*?)\)/g,
      'fatalError(String(describing: $1))'
    );
    // EXSharedApplication() -> UIApplication.shared
    s = s.replace(/\bEXSharedApplication\s*\(\s*\)/g, 'UIApplication.shared');
  }

  if (s !== before) {
    fs.writeFileSync(file, s);
    touched++;
    console.log('  patched:', path.relative(nodeModulesRoot, file));
  }
}

console.log('TAMTAM: patched', touched, 'expo source files');
