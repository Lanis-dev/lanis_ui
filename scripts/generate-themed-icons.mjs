import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import toIco from 'to-ico';
import { themes } from './icon-palettes.mjs';

const faviconDirectory = join(process.cwd(), 'public', 'favicon');
const sourceSvg = await readFile(new URL('./assets/icon-source.svg', import.meta.url), 'utf8');
const hex = (channels) => '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');

const iconSizes = {
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'apple-touch-icon.png': 180,
  'android-chrome-192x192.png': 192,
  'android-chrome-512x512.png': 512,
};

for (const [themeName, theme] of Object.entries(themes)) {
  const themeDirectory = join(faviconDirectory, 'themes', themeName);
  await mkdir(themeDirectory, { recursive: true });

  // Match the artwork's original fills even if the ruby palette changes.
  const colors = { '#f43f5e': hex(theme.base), '#2d0812': hex(theme.hat) };
  const themedSvg = sourceSvg.replace(/#f43f5e|#2d0812/g, (color) => colors[color]);
  await writeFile(join(themeDirectory, 'icon.svg'), themedSvg);

  for (const [filename, size] of Object.entries(iconSizes)) {
    await sharp(Buffer.from(themedSvg))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(join(themeDirectory, filename));
  }

  const manifest = {
    name: 'Lanis — Schulportal Hessen',
    short_name: 'Lanis',
    icons: [
      {
        src: `/favicon/themes/${themeName}/android-chrome-192x192.png`,
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: `/favicon/themes/${themeName}/android-chrome-512x512.png`,
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: `/favicon/themes/${themeName}/icon.svg`,
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
    theme_color: theme.themeColor,
    background_color: '#fcfcf9',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    lang: 'de',
  };

  await writeFile(
    join(themeDirectory, 'site.webmanifest'),
    `${JSON.stringify(manifest)}\n`,
  );
}

// Legacy/direct URLs and push fallbacks use the default ruby theme too.
const defaultDirectory = join(faviconDirectory, 'themes', 'ruby');
for (const filename of [...Object.keys(iconSizes), 'icon.svg', 'site.webmanifest']) {
  await copyFile(join(defaultDirectory, filename), join(faviconDirectory, filename));
}
const ico = await toIco(await Promise.all(
  ['favicon-16x16.png', 'favicon-32x32.png'].map(filename => readFile(join(defaultDirectory, filename))),
));
await writeFile(join(faviconDirectory, 'favicon.ico'), ico);
await sharp(join(defaultDirectory, 'icon.svg'))
  .webp({ lossless: true }).toFile(join(process.cwd(), 'public', 'icon.webp'));
