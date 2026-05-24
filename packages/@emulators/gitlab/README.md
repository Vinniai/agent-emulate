# @emulators/gitlab

Direct gitlab — native REST surface (OAuth2 token + Project, Issue) driven by @emulators/native-kit from the SDK-aligned seed.

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

```ts
import { createServer } from "@emulators/core";
import { gitlabPlugin } from "@emulators/gitlab";

const { app } = createServer(gitlabPlugin, { baseUrl: "http://localhost:4000" });
```
