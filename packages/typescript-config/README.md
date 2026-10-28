# @garita/typescript-config

Configuraciones base de TypeScript compartidas por el monorepo.

| Archivo           | Uso                                                               |
| ----------------- | ----------------------------------------------------------------- |
| `base.json`       | Opciones estrictas comunes a todos los paquetes                   |
| `library.json`    | Paquetes internos empaquetados con un bundler (`packages/shared`) |
| `nestjs.json`     | API con NestJS (CommonJS, decoradores)                            |
| `vite-react.json` | Panel web con React y Vite                                        |

```json
{
  "extends": "@garita/typescript-config/nestjs.json"
}
```
