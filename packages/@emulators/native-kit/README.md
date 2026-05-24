# @emulators/native-kit

Generic direct-to-source engine: turns a provider seed slice into a standalone native-API ServicePlugin.

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

```ts
import { createServer } from "@emulators/core";
import { nativeKitPlugin } from "@emulators/native-kit";

const { app } = createServer(nativeKitPlugin, { baseUrl: "http://localhost:4000" });
```
