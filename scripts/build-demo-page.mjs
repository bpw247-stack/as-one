// Builds the demo (sample data, no server) as one self-contained HTML page,
// for sharing As One as a link: everything — JavaScript, styles and icons —
// is inlined, so the page needs no other files.
//
//   npm run demo:page      → dist-demo/as-one-demo.html

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-demo';
execSync(`npx expo export --platform web --output-dir ${out}/export`, {
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_DEMO: '1', CI: '1' },
});

const exportDir = join(out, 'export');
const jsDir = join(exportDir, '_expo/static/js/web');
const cssDir = join(exportDir, '_expo/static/css');
const js = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`Expected one bundle, found ${js.length}: async routes must be off`);

let bundle = readFileSync(join(jsDir, js[0]), 'utf8');
// Inline every image the bundle points to.
bundle = bundle.replace(/"(\/assets\/[^"]+\.png)"/g, (_, path) => {
  const data = readFileSync(join(exportDir, path)).toString('base64');
  return `"data:image/png;base64,${data}"`;
});
// Keep the script tag from closing early.
bundle = bundle.replace(/<\/script/gi, '<\\/script');

const css = readdirSync(cssDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(cssDir, f), 'utf8'))
  .join('\n');

const page = `<title>As One</title>
<meta name="description" content="A demo of As One with sample people. Nothing is saved.">
<style>
html, body { height: 100%; }
body { overflow: hidden; margin: 0; }
#root { display: flex; height: 100%; flex: 1; }
${css}
</style>
<div id="root"></div>
<script>${bundle}</script>
`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'as-one-demo.html'), page);
console.log(`Wrote ${join(out, 'as-one-demo.html')} (${(page.length / 1e6).toFixed(1)} MB)`);
