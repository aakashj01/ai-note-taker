// Renders the app icons from an inline SVG. Run: node scripts/make-icons.cjs
const { chromium } = require('playwright');
const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#4f46e5"/>
<rect x="38" y="20" width="24" height="40" rx="12" fill="#fff"/>
<path d="M28 48a22 22 0 0 0 44 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
<path d="M50 70v10M38 80h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
<rect x="64" y="62" width="22" height="4" rx="2" fill="#c7c4ff"/><rect x="64" y="70" width="16" height="4" rx="2" fill="#c7c4ff"/></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<body style="margin:0">${svg(size)}</body>`);
    await p.screenshot({ path: `icons/${name}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await b.close();
})();
