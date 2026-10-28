# Despliegue del ambiente de staging

El ambiente de staging se despliega desde la rama `develop` y es el que se usa para probar webhooks y notificaciones push, que necesitan URLs públicas. Todo corre en planes gratuitos.

```
Vercel (panel web) ──▶ Render (API NestJS) ──▶ Neon (PostgreSQL)
                                │
                                └──▶ Render Key Value (Redis / BullMQ)
EAS Build (app móvil) ──▶ Render (API NestJS)
```

| Componente    | Plataforma                      | Configuración en el repo | Se despliega                           |
| ------------- | ------------------------------- | ------------------------ | -------------------------------------- |
| API           | Render (web service, plan free) | `render.yaml`            | Push a `develop` con el CI aprobado    |
| Redis         | Render Key Value (plan free)    | `render.yaml`            | Junto con el Blueprint                 |
| Base de datos | Neon                            | —                        | Migraciones en cada deploy de la API   |
| Panel web     | Vercel                          | `apps/web/vercel.json`   | Push a `develop`                       |
| App móvil     | EAS Build                       | `apps/mobile/eas.json`   | Manual (`eas build --profile preview`) |

## 1. Base de datos en Neon

1. Crear el proyecto `garita` en la región **AWS us-east-1** (la más cercana a la región `virginia` de Render).
2. Crear la rama `staging` y copiar su _connection string_ con `sslmode=require`.

## 2. API y Redis en Render

1. En Render: **New → Blueprint** y seleccionar el repositorio. Render lee `render.yaml`.
2. Completar las variables marcadas con `sync: false`:
   - `DATABASE_URL`: connection string de Neon.
   - `CORS_ORIGINS`: URL del panel en Vercel (por ejemplo `https://garita-staging.vercel.app`).
3. `REDIS_URL` se completa sola con la conexión interna de la instancia de Key Value.
4. Verificar: `GET https://<servicio>.onrender.com/api/v1/health/ready` debe responder `200`.

Consideraciones del plan free:

- El servicio se suspende tras 15 minutos sin tráfico; el primer pedido después tarda en responder.
- `preDeployCommand` no está disponible, por eso `prisma migrate deploy` corre al final del build. Si el deploy falla después de migrar, la base queda con la migración aplicada: las migraciones deben ser compatibles con la versión anterior del código.
- La instancia free de Key Value no persiste datos: alcanza para staging, no para producción.

## 3. Panel web en Vercel

1. En Vercel: **Add New → Project**, importar el repositorio y elegir **Root Directory** `apps/web`. Vercel detecta pnpm y Turborepo.
2. En **Settings → Git**, usar `develop` como rama de producción del proyecto de staging.
3. Variable de entorno `VITE_API_URL`: `https://<servicio>.onrender.com/api/v1`.
4. Agregar la URL final del panel a `CORS_ORIGINS` en Render.

## 4. App móvil con EAS

```bash
cd apps/mobile
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://<servicio>.onrender.com/api/v1 --visibility plaintext
pnpm dlx eas-cli@latest build --profile preview --platform android
```

El perfil `preview` genera un APK de distribución interna para instalar en los celulares de prueba.

## Variables por componente

| Variable              | Componente | Dónde se configura              |
| --------------------- | ---------- | ------------------------------- |
| `NODE_ENV`            | API        | `render.yaml`                   |
| `DATABASE_URL`        | API        | Render (secreta)                |
| `REDIS_URL`           | API        | `render.yaml` (desde Key Value) |
| `CORS_ORIGINS`        | API        | Render                          |
| `VITE_API_URL`        | Web        | Vercel                          |
| `EXPO_PUBLIC_API_URL` | App        | EAS (entorno `preview`)         |
