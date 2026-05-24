# Simpro — design tokens (curated)

`brandmd` extraction of <https://www.simprogroup.com> was blocked by the site's
bot protection ("No pages extracted successfully"). The tokens below are curated
from Simpro's public brand (green primary, light surfaces) and are the values
used by the `simpro` entry in `packages/@emulators/core/src/themes.ts`.

| Token   | Value     |
| ------- | --------- |
| scheme  | light     |
| bg      | `#ffffff` |
| surface | `#ffffff` |
| border  | `#dde3ea` |
| text    | `#1f2d3d` |
| muted   | `#5b6b7b` |
| accent  | `#0a8a3f` |
| font    | Open Sans / system |
| radius  | `4px`     |

To refresh automatically once the site is reachable:

```bash
npx brandmd https://www.simprogroup.com -o documentation/provider-designs/simpro/DESIGN.md
```
