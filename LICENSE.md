# License Overview

CurrentUsage is open source, with licenses chosen per component:

| Component | Path | License | Why |
|---|---|---|---|
| Cloud dashboard (server, frontend, bridge) | [`cloud-dashboard/`](./cloud-dashboard) | **AGPL-3.0** ([text](./cloud-dashboard/LICENSE)) | Anyone hosting a modified version as a service must share their source — keeps the project's hosted edition on equal footing. |
| Device firmware (ESP32-C3, ESP-IDF) | [`cu100/`](./cu100) | **Apache-2.0** ([text](./cu100/LICENSE)) | Permissive, standard for the ESP-IDF ecosystem, upstream-friendly. |
| Hardware design files | planned — `hardware/` | **CERN-OHL-S v2** | Reciprocal open hardware: derivatives stay open. |
| Documentation | [`docs/`](./docs) | **CC-BY-SA 4.0** | Standard for docs, share-alike. |

## Summary in plain language

- **You may** use, study, modify, and redistribute everything here — including
  commercially.
- **You must** keep modifications to the dashboard open if you offer it as a
  hosted service (AGPL-3.0 §13), keep firmware notices on redistribution
  (Apache-2.0), and share hardware derivatives openly (CERN-OHL-S).
- **There is no warranty.** Energy-monitoring hardware touches your
  electrical panel — follow local electrical codes and use a qualified
  installer where required.

See each component folder for the full license text.
