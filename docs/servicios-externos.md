# Servicios externos

Cuentas y proyectos que necesita Garita. Se crean una sola vez, con la cuenta institucional cuando el servicio lo permita, y sus credenciales **nunca** se commitean: van en los `.env` locales o en las variables de entorno de cada plataforma.

Para cada servicio conviene crear dos proyectos o entornos separados: **staging** y **producción**.

## Checklist

| Servicio                                                                  | Para qué se usa                      | Qué crear                                                                    | Variables que resultan                                            | Sprint         |
| ------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------- |
| [GitHub](https://github.com)                                              | Repositorio y CI                     | Repositorio `Garita`, protección de ramas `main` y `develop`                 | —                                                                 | 0              |
| [Neon](https://neon.tech)                                                 | PostgreSQL administrado              | Proyecto `garita` en `us-east-1`, rama `staging`                             | `DATABASE_URL` (API)                                              | 0              |
| [Render](https://render.com)                                              | Hosting de la API y Redis            | Blueprint desde `render.yaml`                                                | `REDIS_URL` (automática)                                          | 0              |
| [Vercel](https://vercel.com)                                              | Hosting del panel web                | Proyecto con _Root Directory_ `apps/web`                                     | `VITE_API_URL` (web)                                              | 0              |
| [Expo / EAS](https://expo.dev)                                            | Builds de la app móvil               | Proyecto `garita` (`eas init`)                                               | `EXPO_PUBLIC_API_URL` (en EAS)                                    | 0              |
| [Firebase](https://console.firebase.google.com)                           | Authentication y Cloud Messaging     | Proyectos `garita-staging` y `garita-prod`, apps web, Android e iOS          | Claves públicas de Firebase (web y app), cuenta de servicio (API) | 1 y 4          |
| [Google Maps Platform](https://console.cloud.google.com/google/maps-apis) | Mapas de predios y puntos de control | Proyecto de Google Cloud con Maps JavaScript API y Maps SDK para Android/iOS | Claves restringidas por dominio y por app                         | 1              |
| [Cloudinary](https://cloudinary.com)                                      | Fotos de incidentes                  | Cuenta y _upload preset_ firmado                                             | Cloud name, API key y secret (API)                                | 3              |
| [Mercado Pago Developers](https://www.mercadopago.com.ar/developers)      | Suscripciones y webhooks             | Aplicación y usuarios de prueba (vendedor y comprador)                       | Access token, clave secreta del webhook (API)                     | 0 (prueba) y 5 |

> Las variables se agregan al esquema de validación y al `.env.example` de cada app recién cuando el código empieza a usarlas, en el sprint correspondiente.

## Reglas de seguridad

- Las claves de **Firebase Admin**, **Cloudinary** (secret) y **Mercado Pago** (access token y secreto del webhook) solo existen en la API.
- Las claves que viajan al cliente (Firebase web/app, Google Maps) deben estar **restringidas** por dominio (Vercel) o por identificador de la app (`com.garita.app`).
- Mercado Pago se usa con **credenciales de prueba** hasta el pase a producción del Sprint 6.
- Si una credencial se filtra (por ejemplo, en un commit), se revoca y se genera una nueva: borrar el commit no alcanza.
