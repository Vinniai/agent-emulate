# @emulators/salesforce

Direct Salesforce — OAuth2 (password/code/refresh), sObjects CRUD, SOQL query, composite create, describe.

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

```ts
import { createServer } from "@emulators/core";
import { salesforcePlugin } from "@emulators/salesforce";

const { app } = createServer(salesforcePlugin, { baseUrl: "http://localhost:4000" });
```
