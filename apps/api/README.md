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

## Autenticación y permisos

### Limitación conocida: límite de canje de invitaciones

El endpoint de canje limita a 10 intentos por IP y minuto con un contador en memoria por proceso. El contador no se comparte entre réplicas ni sobrevive a reinicios; antes de escalar la API a varias réplicas, mover este límite a Redis para aplicar una cuota distribuida.

- Inyectá `PrismaService` y usá `prisma.tenantPrisma`; un contexto `AsyncLocalStorage` por request entrega al cliente el usuario autenticado.
- La extensión de Prisma aplica el tenant a lecturas, escrituras, conteos y agregaciones; no hace falta agregar `companyId` a cada consulta.
- Prisma 7 permite filtros adicionales junto a la clave única; `findUnique` conserva la clave y agrega la restricción tenant en el mismo `where`.
- `User` filtra por `companyId`; `Invitation` filtra por su `user.companyId`; `Company` es la raíz tenant y filtra por su `id` igual al `companyId` autenticado.
- Modelo directo nuevo: agregalo a `COMPANY_ID_MODELS`; `TENANT_MODELS` se deriva de esa lista y el test compara los campos con `schema.prisma`.
- Modelo indirecto nuevo: agregá una entrada en `INDIRECT_TENANT_MODELS` con la relación que conduce a `companyId`.
- Buscá recursos por ID con `TenantResourceService.findOwnedOrThrow('User', id)` (modelo, id): devuelve el registro propio; si pertenece a otra empresa registra `Logger.error` y responde el mismo 404 que un ID inexistente.
- `systemPrisma` omite el filtro y queda reservado al guard de Firebase, datos/operaciones de sistema y verificaciones internas de pertenencia; el seed crea su propio cliente de sistema.
- Declarar roles con `@Roles('admin', ...)`; sin roles, el guard autentica y luego deniega con 403.
- Declarar rutas públicas con `@Public()`; solo `@AllowPendingInvitation()` permite que una invitación pendiente complete `GET /auth/me`.
