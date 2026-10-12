# API de Garita

API central del sistema: REST y WebSockets con [NestJS](https://nestjs.com), organizada como monolito modular (un módulo por dominio).

## Puesta en marcha

Desde la raíz del monorepo:

```bash
docker compose up -d                 # PostgreSQL y Redis
cp apps/api/.env.example apps/api/.env
pnpm --filter api db:generate        # Genera el cliente de Prisma
pnpm --filter api dev                # API en http://localhost:3000/api/v1
```

> Si ya hay un PostgreSQL instalado en el puerto 5432, crear un `.env` en la raíz con `POSTGRES_PORT=5433` y usar ese puerto en `DATABASE_URL`.

## Scripts

| Script                 | Descripción                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `dev`                  | API en modo watch                                                |
| `build` / `start:prod` | Compila a `dist/` y lo ejecuta                                   |
| `test`                 | Tests unitarios (Jest)                                           |
| `test:e2e`             | Tests de integración (Supertest). Requieren PostgreSQL y Redis   |
| `db:generate`          | Genera el cliente de Prisma en `src/generated/`                  |
| `db:migrate`           | Crea y aplica una migración en desarrollo (`-- --name <nombre>`) |
| `db:deploy`            | Aplica las migraciones pendientes (staging y producción)         |
| `db:studio`            | Abre Prisma Studio                                               |

## Endpoints de salud

| Ruta                       | Uso                                               |
| -------------------------- | ------------------------------------------------- |
| `GET /api/v1/health/live`  | El proceso está vivo (no consulta dependencias)   |
| `GET /api/v1/health/ready` | PostgreSQL y Redis responden; si no, devuelve 503 |

## Estructura

```
prisma/              # Esquema y migraciones
src/
├── main.ts          # Arranque de la aplicación
├── setup-app.ts     # Configuración HTTP compartida con los tests
├── config/          # Validación de variables de entorno y opciones de colas
├── modules/         # Un módulo por dominio (health, prisma, auth, rondas, ...)
└── generated/       # Cliente de Prisma (no se versiona)
test/                # Tests de integración (*.e2e-spec.ts)
```

> La API se compila a CommonJS. Como NestJS 12 se distribuye como ESM, Jest se ejecuta con `--experimental-vm-modules` para poder cargarlo.

# API de Garita

## Autenticación y permisos

La API verifica Firebase ID tokens y carga rol, empresa y estado desde PostgreSQL. Los endpoints requieren `@Roles(...USER_ROLES)`; omitir el decorador deniega el acceso. `@Public()` habilita explícitamente rutas públicas como health. Los controladores reciben el contexto validado con `@CurrentUser()` (`userId`, `companyId`, `role`, `status`).

| Estado / rol                             | Acceso                                              |
| ---------------------------------------- | --------------------------------------------------- |
| Sin token o token inválido               | 401                                                 |
| `deactivated` o `invitation_pending`     | 403, excepto `/auth/me` activa al usuario pendiente |
| `admin`, `supervisor`, `guard`, `client` | Solo endpoints que declaran explícitamente el rol   |
| Ruta `@Public()`                         | Acceso sin autenticación                            |

Para aislar datos multiempresa, cada servicio aplica `companyScope(user, filtros)` a la consulta de Prisma; el `companyId` autenticado prevalece sobre los filtros recibidos. Las búsquedas de recursos deben convertir el resultado fuera de la empresa en el mismo 404 que un ID inexistente y registrar el intento con nivel error.
