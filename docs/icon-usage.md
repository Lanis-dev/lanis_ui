# LANIS icon usage

The theme palette is defined in `scripts/icon-palettes.mjs`. Run
`node scripts/generate-themed-icons.mjs` and `node scripts/generate-opengraph.mjs`
after changing it. The master artwork is
[`scripts/assets/icon-source.svg`](../scripts/assets/icon-source.svg).
The generator applies the theme's background and cap colors to the same vector paths
and renders the PNG, ICO and WebP assets. Option D applies
`round(channel * 0.4)` to each harmonious hat color, including cyan.

| Surface | Source | Behavior |
| --- | --- | --- |
| Login, onboarding, mobile header, desktop sidebar | `AppIcon` | Selected theme via `getThemeIconUrl` |
| Landing header, install promotion | `AppIcon` | Selected theme, default ruby |
| Status and incident headers | `AppIcon` | Selected theme |
| Agent authorization, including error states | `AppIcon` | Selected theme |
| Browser favicon, Apple touch icon, install manifest | `index.html`, `applyThemeAssets` | Selected theme; SVG favicon and manifest icon, with PNGs for raster consumers |
| Prerendered school pages | `ThemeProvider` with school color | Closest supported theme artwork |
| Direct `/favicon/*` URLs and `/icon.webp` | Icon generator | Default ruby; aliases match the themed ruby artwork |
| Browser push icon and badge | `public/sw.js` | Default ruby through root favicon aliases |
| Link previews, Open Graph, Twitter | `generate-opengraph.mjs`, `SEO`, `index.html` | Fixed ruby branding with the shared ruby hat palette |
| Android launchers and round launchers | `generate-android-icons.mjs` on `feat/android-app` | Packaged copies of all nine 512px theme images |
| Android recent-apps/task icon | `MainActivity.kt` | Selected launcher resource |
| Android system splash | `ic_lanis_splash` → `ic_lanis` → `ic_lanis_ruby` | Default ruby |
| Android launcher shortcuts | `ic_lanis` | Full-color Ruby artwork |
| Android notifications and Quick Settings | `ic_lanis_system` | Official SVG cap path, tinted by Android |
| Admin portal header | `lanis_admin/public/lanis-logo.svg` | Copy of the generated cyan SVG |

`lanis_api` contains no bundled LANIS icon references. The admin portal is a
separate repository. Android resources live on the separate `feat/android-app`
branch. Its generator calls the web generator before packaging the launcher PNGs.
Copy the generated cyan SVG to the admin portal when the master artwork changes.

Screenshots under `docs/` and landing screenshots are historical captures rather
than live icon sources. Custom theme colors continue to select the closest
supported icon palette through `getThemeAssetName`.
