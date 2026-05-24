# @emulators/hubspot

Direct HubSpot — OAuth2 + token introspection and the CRM v3/v4 object API (CRUD, search, batch, associations).

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

```ts
import { createServer } from "@emulators/core";
import { hubspotPlugin } from "@emulators/hubspot";

const { app } = createServer(hubspotPlugin, { baseUrl: "http://localhost:4000" });
```
