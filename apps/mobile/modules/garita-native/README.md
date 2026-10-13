# Garita Native

Módulo local Expo para obtener una ubicación puntual con precisión y estado de simulación. No solicita permisos: la pantalla de configuración de Garita y `expo-location` son responsables de ello.

## API JavaScript

`getCurrentLocation({ timeoutMs })` devuelve latitud, longitud, precisión en metros, instante ISO y `simulation` (`simulated`, `not_simulated` o `unavailable`). Rechaza con `PERMISSION_DENIED`, `LOCATION_TIMEOUT` o `LOCATION_UNAVAILABLE`. `getCapabilities()` declara versión y disponibilidad de detección. La app debe llamar al wrapper `src/lib/location.ts`, que valida el resultado y aplica el límite de cinco segundos.

Android usa `LocationManager` para evitar agregar Google Play Services como dependencia nativa; pide una lectura puntual del proveedor GPS (o red si GPS no está disponible), sin seguimiento continuo.

## Extensiones previstas

- HU-14 agregará el reloj monotónico interno como una API adicional, conservando esta API.
- HU-23 agregará envío de SMS en Android, con permisos y comportamiento independiente.

El módulo se autolinkea desde `apps/mobile/modules/garita-native` usando `expo-module.config.json`; su config plugin no añade capacidades del sistema. Para validar el autolinking, ejecutar `pnpm --filter mobile exec expo prebuild --no-install --clean --platform android` y comprobar `@garita/garita-native` en `settings.gradle`/autolinking.
