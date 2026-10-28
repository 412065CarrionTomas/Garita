# @garita/eslint-config

Configuraciones de ESLint (flat config) compartidas por el monorepo.

| Export                        | Uso                                                   |
| ----------------------------- | ----------------------------------------------------- |
| `@garita/eslint-config/base`  | Reglas comunes de TypeScript con información de tipos |
| `@garita/eslint-config/node`  | API (NestJS)                                          |
| `@garita/eslint-config/react` | Panel web (React + Vite)                              |

```js
// eslint.config.js
import { nodeConfig } from '@garita/eslint-config/node';

export default nodeConfig;
```
