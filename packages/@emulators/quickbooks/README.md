# @emulators/quickbooks

Direct QuickBooks Online — OAuth2, stateful invoices, SQL-ish query, and QuickBooks' own signed `eventNotifications[]` webhook.

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

```ts
import { createServer } from "@emulators/core";
import { quickbooksPlugin } from "@emulators/quickbooks";

const { app } = createServer(quickbooksPlugin, { baseUrl: "http://localhost:4000" });
```
