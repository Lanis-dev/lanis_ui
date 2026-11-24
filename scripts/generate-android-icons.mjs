import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { themes } from './icon-palettes.mjs';

// Refresh web artwork first so native resources use the same SVG master.
await import('./generate-themed-icons.mjs');
const output = 'android/app/src/main/res/drawable';
const svg = await readFile(new URL('./assets/icon-source.svg', import.meta.url), 'utf8');
const cap = svg.match(/<path id="cap" d="([^"]+)"/)?.[1].trim().replace(/\s+/g, ' ');
if (!cap) throw new Error('The LANIS icon master is missing its cap path.');

// Android draws status and Quick Settings icons from their alpha silhouettes.
await writeFile(`${output}/ic_lanis_system.xml`, `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="340" android:viewportHeight="340">
    <group android:translateX="-94" android:translateY="-86">
        <path android:fillColor="#ffffff" android:pathData="${cap}" />
    </group>
</vector>\n`);
// Keep the cap at its full-color scale within the 108dp adaptive layer.
await writeFile(`${output}/ic_lanis_monochrome.xml`, `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="768" android:viewportHeight="768">
    <group android:translateX="120" android:translateY="128">
        <path android:fillColor="#ffffff" android:pathData="${cap}" />
    </group>
</vector>\n`);
// Launcher assets come from the same official generated artwork used by the web UI.
// Android expands adaptive layers from the visible 72dp viewport to 108dp.
// Inset the web artwork by 18/108 on each side to preserve its intended scale.
const launcherIcon = theme => `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_${theme}" />
    <foreground>
        <inset android:inset="16.6667%">
            <bitmap android:src="@drawable/ic_lanis_${theme}" android:gravity="fill" />
        </inset>
    </foreground>
    <monochrome android:drawable="@drawable/ic_lanis_monochrome" />
</adaptive-icon>\n`;
await mkdir('android/app/src/main/res/drawable-nodpi', { recursive: true });
await rm('android/app/src/main/res/mipmap-anydpi-v26', { recursive: true, force: true });
await rm(`${output}/ic_lanis.xml`, { force: true });
for (const theme of Object.keys(themes)) {
  await copyFile(`public/favicon/themes/${theme}/android-chrome-512x512.png`, `android/app/src/main/res/drawable-nodpi/ic_lanis_${theme}.png`);
  await writeFile(`android/app/src/main/res/mipmap-anydpi/ic_launcher_${theme}.xml`, launcherIcon(theme));
}
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  await writeFile(`android/app/src/main/res/mipmap-anydpi/${name}.xml`, launcherIcon('ruby'));
}
await rm('android/app/src/main/res/drawable-nodpi/ic_lanis.png', { force: true });
await writeFile(`${output}/ic_lanis.xml`, '<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/ic_lanis_ruby" android:gravity="fill" />\n');
// The system splash also applies a circular mask.
await writeFile(`${output}/ic_lanis_splash.xml`, '<inset xmlns:android="http://schemas.android.com/apk/res/android" android:inset="16.6667%" android:drawable="@drawable/ic_lanis" />\n');
const colors = Object.entries(themes).map(([name, theme]) => {
  const hex = theme.base.map(channel => channel.toString(16).padStart(2, '0')).join('');
  return `<color name="icon_${name}">#${hex}</color>`;
});
await writeFile('android/app/src/main/res/values/icon_colors.xml', `<resources>${colors.join('')}</resources>\n`);
