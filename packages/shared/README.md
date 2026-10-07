# @garita/shared

Contratos compartidos entre la API, el panel web y la app móvil: tipos, constantes y esquemas de validación con Zod.

- Se compila con [tsdown](https://tsdown.dev) a ESM y CommonJS (la API con NestJS usa CommonJS).
- Todo lo que se exporta debe ser independiente de la plataforma: nada de APIs de Node.js, del navegador ni de React Native.
- Los textos visibles para el usuario van en español; los identificadores, en inglés.

```ts
import { userRoleSchema, type UserRole } from '@garita/shared';
```

## Scripts

| Script       | Descripción                            |
| ------------ | -------------------------------------- |
| `pnpm build` | Genera `dist/` (ESM, CommonJS y tipos) |
| `pnpm dev`   | Recompila al detectar cambios          |
| `pnpm test`  | Tests con Jest                         |
