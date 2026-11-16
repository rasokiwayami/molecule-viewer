import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...(await files(`${dir}/${entry.name}`, `${path}/`)));
    else result.push(path);
  }
  return result.sort();
}
const all = await files('dist');
// Files needed only for hand control are fetched and cached when it is first switched on.
const handsOnly = (path) => path.startsWith('mediapipe/') || /^assets\/(hands-worker|landmarker|vision_bundle)-/.test(path);
const pre = all.filter((path) => path !== 'sw.js' && !handsOnly(path));
const hands = all.filter(handsOnly);
const template = await readFile('public/sw.js', 'utf8');
const hash = createHash('sha256').update(template);
for (const path of pre) hash.update(path).update(await readFile(`dist/${path}`));
const code = template
  .replace('__VERSION__', hash.digest('hex').slice(0, 16))
  .replace('__PRECACHE__', JSON.stringify(pre))
  .replace('__HAND_ASSETS__', JSON.stringify(hands));
await writeFile('dist/sw.js', code);
console.log(`Service Worker: ${pre.length} precached files; ${hands.length} optional hand assets`);
