# @emulators/xero

Direct Xero Accounting — OAuth2, tenants, stateful Invoices, and Xero's own signed `events[]` webhook.

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

```ts
import { createServer } from "@emulators/core";
import { xeroPlugin } from "@emulators/xero";

const { app } = createServer(xeroPlugin, { baseUrl: "http://localhost:4000" });
```
