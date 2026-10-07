# API de Garita

API central del sistema: REST y WebSockets con [NestJS](https://nestjs.com), organizada como monolito modular (un módulo por dominio).

## Desarrollo

Desde la raíz del monorepo:

```bash
pnpm --filter api dev        # API en modo watch
pnpm --filter api test       # Tests unitarios (Jest)
pnpm --filter api test:e2e   # Tests de integración (Supertest)
```

## Estructura

```
src/
├── main.ts          # Arranque de la aplicación
├── app.module.ts    # Módulo raíz: importa los módulos de dominio
└── modules/         # Un módulo por dominio (auth, rondas, incidentes, ...)
test/                # Tests de integración (*.e2e-spec.ts)
```

> La API se compila a CommonJS. Como NestJS 12 se distribuye como ESM, Jest se ejecuta con `--experimental-vm-modules` para poder cargarlo.
