# App móvil de Garita

App del **vigilador** para Android e iOS, hecha con [Expo](https://expo.dev) y [Expo Router](https://docs.expo.dev/router/introduction/).

## Desarrollo

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm --filter mobile start      # Servidor de Metro
pnpm --filter mobile test       # Tests con jest-expo
```

La app usa módulos nativos (NFC, SMS, ubicación en segundo plano), por lo que se prueba con un **development build** y no con Expo Go:

```bash
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest init                                  # Vincula el proyecto con EAS (una sola vez)
pnpm dlx eas-cli@latest build --profile development --platform android
```

## Perfiles de EAS Build

| Perfil        | Uso                                     | Entorno de variables |
| ------------- | --------------------------------------- | -------------------- |
| `development` | Development build con `expo-dev-client` | `development`        |
| `preview`     | APK de prueba para distribución interna | `preview`            |
| `production`  | Publicación en Google Play y App Store  | `production`         |

## Variables de entorno

| Variable              | Descripción                               |
| --------------------- | ----------------------------------------- |
| `EXPO_PUBLIC_API_URL` | URL base de la API, con prefijo y versión |

Las variables `EXPO_PUBLIC_*` se incrustan en la app y son públicas. Para los builds de EAS se cargan con `eas env:create` en el entorno correspondiente.

> En un celular físico, `localhost` apunta al propio celular: usar la IP de la PC en la red local.
