# AGENTS.md — Garita

Guía para agentes de IA (Claude Code, Codex, Cursor, Copilot, etc.) que trabajen en este repositorio. Leer completo antes de hacer cualquier cambio.

Repositorio: https://github.com/412065CarrionTomas/Garita

---

## 1. Descripción del proyecto

Garita es un sistema de gestión de vigilancia compuesto por:

- **Panel web (PWA)** para los roles **administrador**, **supervisor** y **cliente**.
- **App móvil** para el rol **vigilador** (Android e iOS), con soporte de **modo sin señal**.
- **API** central que expone REST y WebSockets.

## 2. Stack tecnológico

| Capa | Tecnologías |
|---|---|
| Base de datos | PostgreSQL + Prisma ORM · SQLite en el celular (modo sin señal) · Redis (tareas programadas) |
| Frontend web | React + TypeScript (Vite), Tailwind CSS, shadcn/ui, PWA instalable (vite-plugin-pwa), TanStack Query, Recharts |
| App móvil | React Native + Expo: Expo Camera (QR), React Native NFC Manager (NFC), Expo Location, Expo SQLite, Expo Notifications, Expo SMS, React Native Maps |
| Backend | Node.js + NestJS (TypeScript), monolito modular, API REST + WebSockets (Socket.IO), BullMQ, Zod |
| APIs externas | Firebase Authentication, Firebase Cloud Messaging, Google Maps Platform, Mercado Pago (suscripciones y webhooks), Cloudinary |
| Testing | Jest (unitarios), Supertest (integración de la API), React Testing Library |
| CI/CD y despliegue | GitHub Actions · Render (API) · Vercel (web) · Neon (PostgreSQL) · EAS Build (app) |
| Monorepo | pnpm workspaces + Turborepo |

## 3. Estructura del monorepo

> DEFINIR


## 4. Comandos

Usar siempre **pnpm** (nunca npm ni yarn).

```bash
pnpm install                       # Instalar dependencias
pnpm dev                           # Levantar todo con Turborepo
pnpm --filter api dev              # Solo la API
pnpm --filter web dev              # Solo el panel web
pnpm --filter mobile start         # Solo la app (Expo)
pnpm build                         # Build de todo
pnpm lint                          # Lint
pnpm typecheck                     # Chequeo de tipos
pnpm test                          # Tests

# Prisma (desde apps/api)
pnpm prisma migrate dev --name <nombre_descriptivo>
pnpm prisma generate
```

Antes de dar una tarea por terminada: `pnpm lint`, `pnpm typecheck` y `pnpm test` deben pasar.

## 5. Convenciones de código

### Generales
- TypeScript en modo `strict`. **Prohibido `any`**; usar `unknown` y validar.
- Validar con **Zod** toda entrada externa: bodies, query params, payloads de WebSocket, webhooks y datos leídos de SQLite.
- Nombres de variables, funciones y archivos en inglés; textos visibles para el usuario en español.
- No dejar `console.log` de depuración. En la API usar el `Logger` de NestJS.
- No hardcodear secretos, URLs ni claves. Todo va en variables de entorno y se documenta en `.env.example`.

### Backend (NestJS)
- Monolito modular: un **módulo por dominio** (ej. `auth`, `rondas`, `incidentes`, `puestos`, `suscripciones`). Un módulo no accede al repositorio/Prisma de otro; se comunica mediante su servicio exportado.
- Controladores finos: la lógica de negocio va en los servicios.
- Autenticación con **Firebase Authentication**: verificar el ID token en un guard y aplicar control de acceso por rol (administrador, supervisor, cliente, vigilador).
- WebSockets con **Socket.IO** mediante gateways de NestJS; autenticar la conexión.
- Tareas programadas y en segundo plano con **BullMQ + Redis**. Los jobs deben ser idempotentes y tener reintentos configurados.
- Webhooks de **Mercado Pago**: verificar la firma, responder rápido y procesar en un job de BullMQ. Deben ser idempotentes (el mismo evento puede llegar más de una vez).

### Base de datos (Prisma)
- Todo cambio de esquema pasa por una migración con nombre descriptivo. **Nunca** editar migraciones ya aplicadas.
- No usar `prisma db push` contra entornos compartidos (Neon).
- Usar transacciones cuando una operación toque varias tablas.

### Frontend web
- Componentes de UI con **shadcn/ui** y estilos con **Tailwind**. No agregar otras librerías de componentes ni CSS suelto sin justificación.
- Estado del servidor con **TanStack Query**; no duplicarlo en estado local.
- Gráficos con **Recharts**.
- Diseño responsive (mobile first). Mantener funcionando la instalación como PWA.
- Las vistas se separan por rol; no mostrar acciones que el rol no puede ejecutar (la API igual debe validarlo).

### App móvil (Expo)
- El **modo sin señal** es crítico: toda acción del vigilador (lecturas QR/NFC, ubicación, incidentes) se guarda primero en **SQLite** y luego se sincroniza con la API. No asumir conectividad.
- La sincronización debe ser idempotente (usar IDs generados en el cliente) y tolerar reintentos.
- Expo SMS es el canal de respaldo cuando no hay datos; no reemplaza la sincronización.
- Pedir permisos (cámara, ubicación, NFC, notificaciones) en el momento de uso y manejar el caso de rechazo.
- Notificaciones push con **Firebase Cloud Messaging** / Expo Notifications.
- Imágenes subidas a **Cloudinary**; en la base de datos se guarda solo la URL/ID.

## 6. Testing

- **Jest** para tests unitarios de servicios y lógica de negocio.
- **Supertest** para tests de integración de endpoints de la API.
- **React Testing Library** para componentes; testear comportamiento, no implementación.
- Todo fix de bug incluye un test que lo reproduzca.
- Mockear servicios externos (Firebase, Mercado Pago, Cloudinary, Google Maps) en los tests; nunca llamar a servicios reales.

## 7. Flujo de ramas (Git Flow)

```
main        ← producción. Solo recibe merges de release/* y hotfix/*
 ├─ hotfix/*   sale de main → vuelve a main y a develop
develop     ← integración
 ├─ feature/*  sale de develop → vuelve a develop
 ├─ fix/*      sale de develop → vuelve a develop
 └─ release/*  sale de develop → se mergea a main (con tag de versión) y vuelve a develop
```

| Rama | Sale de | Se mergea en | Uso |
|---|---|---|---|
| `main` | — | — | Código en producción |
| `develop` | `main` | — | Integración de lo próximo a publicar |
| `feature/<descripcion>` | `develop` | `develop` | Funcionalidad nueva |
| `fix/<descripcion>` | `develop` | `develop` | Corrección de bug no urgente |
| `release/<version>` | `develop` | `main` y `develop` | Preparar y subir una versión a producción |
| `hotfix/<descripcion>` | `main` | `main` y `develop` | Corrección urgente en producción |

Reglas:

- **Nunca** commitear directo en `main` ni en `develop`.
- Nombres de rama en minúsculas y con guiones: `feature/lectura-nfc`, `fix/sync-offline`, `release/1.2.0`, `hotfix/webhook-mercadopago`.
- Las versiones siguen **SemVer** (`MAYOR.MENOR.PARCHE`). Al cerrar un `release/*` o `hotfix/*` en `main`, crear el tag `vX.Y.Z`.
- Antes de crear una rama, verificar que se parte de la rama base correcta y actualizada.

## 8. Commits

### Reglas obligatorias

- **Mensajes en español**, claros y descriptivos.
- **No agregar coautores**: nunca incluir `Co-authored-by:` ni firmas del tipo "Generated with…" / "Co-Authored-By: Claude" o similares en el mensaje.
- **Commits atómicos**: un commit = un cambio lógico. **No** hacer commits que engloben muchas cosas; si hay cambios en API, web y migración, separarlos en varios commits.
- Cada commit debe dejar el proyecto compilando.
- No commitear archivos `.env`, credenciales, builds ni `node_modules`.

### Formato

Se usa Conventional Commits con la descripción en español:

```
<tipo>(<alcance>): <descripción en imperativo y minúscula>

[cuerpo opcional: qué y por qué, no cómo]
```

**Tipos:** `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `chore`, `perf`, `ci`, `build`.
**Alcances sugeridos:** `api`, `web`, `mobile`, `shared`, `db`, `ci`, `deps`.

### Ejemplos

```
feat(mobile): agrega lectura de puntos de control por NFC
fix(api): evita procesar dos veces el mismo webhook de Mercado Pago
feat(db): agrega tabla de incidentes
test(api): agrega tests de integración del módulo de rondas
refactor(web): extrae tabla de vigiladores a un componente
```

### Ejemplo de cómo separar

❌ Mal — un solo commit:
```
feat: agrega incidentes, arregla login y actualiza dependencias
```

✅ Bien — varios commits:
```
feat(db): agrega modelo Incidente en el esquema de Prisma
feat(api): agrega endpoints para registrar incidentes
feat(mobile): permite registrar incidentes sin conexión
fix(web): corrige redirección después del login
chore(deps): actualiza dependencias de Expo
```

## 9. Seguridad

- Nunca exponer claves de Firebase Admin, Mercado Pago, Cloudinary ni Google Maps del lado del cliente (salvo las claves públicas restringidas por dominio/app).
- Validar el rol y la pertenencia del recurso en cada endpoint (un cliente solo ve sus puestos; un supervisor solo sus vigiladores).
- Los datos de ubicación de los vigiladores son sensibles: no loguearlos ni exponerlos fuera de los roles autorizados.

## 10. Qué hacer ante dudas

- Si una tarea implica cambiar el esquema de la base de datos, la estructura del monorepo o agregar una dependencia nueva importante, **consultar antes**.
- Si la tarea es grande, proponer un plan y dividirla en commits pequeños antes de empezar.
