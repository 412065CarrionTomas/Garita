# Spike: reemplazo de Google Maps por MapLibre + OpenFreeMap

**Fecha:** 9 de noviembre de 2026
**Rama:** `feature/mapas-maplibre`
**Alcance:** panel web (`apps/web`). La app móvil hoy no tiene mapa.

---

## 1. Decisión

Se reemplaza Google Maps Platform por:

- **MapLibre GL JS** (`maplibre-gl` + `react-map-gl/maplibre`): la librería que dibuja el mapa en el navegador. Licencia BSD-3, sin clave ni cobro por uso.
- **OpenFreeMap**: el servidor de _tiles_ (los cuadrados con calles, nombres y ríos que el mapa descarga según la zona y el zoom). Gratis, sin clave, sin registro y sin cookies.

MapLibre y OpenFreeMap no compiten entre sí: el primero es el motor y el segundo los datos que muestra. En el código se unen con una sola URL de estilo:

```ts
<Map mapStyle="https://tiles.openfreemap.org/styles/liberty" />
```

### Por qué

| Criterio       | Google Maps (hoy)                                 | MapLibre + OpenFreeMap                                                |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Costo          | Cuenta de facturación en Google Cloud             | $0, sin cuenta                                                        |
| Clave          | `VITE_GOOGLE_MAPS_API_KEY` expuesta (restringida) | Ninguna                                                               |
| Modo oscuro    | Estilo JSON propio de Google (`map-style.ts`)     | Estilo vectorial editable con los tokens                              |
| Rendimiento    | Bueno                                             | WebGL + tiles vectoriales; miles de puntos con GeoJSON y _clustering_ |
| Disponibilidad | SLA de Google                                     | Sin garantía ("tal cual"); mitigable con hosting propio               |

## 2. Qué cambia en el código

Uso actual de Google en `apps/web/src`:

| Archivo                                                                      | Uso actual                                           | Reemplazo                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `features/mapa/live-map-view.tsx`                                            | Supervisión en vivo, marcadores HTML, `LatLngBounds` | `<Map>` + `<Marker>` de react-map-gl, `fitBounds`                           |
| `features/mapa/site-location-map.tsx`                                        | Marcador arrastrable + **Google Places**             | `<Marker draggable>` + buscador de direcciones (ver §4)                     |
| `features/mapa/site-location-map.tsx` (`ClientSitesMap`)                     | Predios del cliente                                  | `<Map>` + `<Marker>`                                                        |
| `features/puntos/checkpoints-panel.tsx`                                      | `AdvancedMarker` con `mapId`                         | `<Marker>` o capa `circle`/`symbol` sobre GeoJSON                           |
| `features/incidentes/incidents-page.tsx`                                     | iframe de Google Maps Embed                          | Mapa chico de MapLibre con un marcador                                      |
| `features/panico/panic-detail-page.tsx`                                      | iframe de Google Maps Embed                          | Ídem                                                                        |
| `features/mapa/map-style.ts`                                                 | `google.maps.MapTypeStyle[]` claro/oscuro            | Dos URLs de estilo (clara y oscura) o un estilo propio con `@garita/tokens` |
| `features/mapa/live-map.tsx`, `site-location.tsx`, `use-site-coordinates.ts` | Se apagan si no hay clave                            | Sin clave: el mapa siempre está disponible; se elimina esa rama             |

Configuración y dependencias:

- Quitar `@vis.gl/react-google-maps` y `@types/google.maps`; agregar `maplibre-gl` y `react-map-gl`.
- Quitar `"google.maps"` de `types` en `tsconfig.app.json` y `tsconfig.test.json`.
- `VITE_GOOGLE_MAPS_API_KEY` → `VITE_MAP_STYLE_URL` (y `VITE_MAP_STYLE_URL_DARK` si se usan dos estilos) en `config/env.ts`, `test/env.ts` y `.env.example`, con OpenFreeMap como valor por defecto. Así se puede cambiar de proveedor sin tocar código.
- Importar `maplibre-gl/dist/maplibre-gl.css`.
- Cargar las pantallas con mapa en diferido (`React.lazy`): el paquete pesa ~200–250 KB comprimido (estimado).
- Tests: jsdom no tiene WebGL; mockear `react-map-gl/maplibre` como hoy se mockea Google (`site-location.test.tsx`).
- Documentación: actualizar `docs/servicios-externos.md` y la tabla de stack de `AGENTS.md`.

## 3. Requisitos que no son código

- **Atribución visible a OpenStreetMap / OpenFreeMap** en el mapa (licencia ODbL de los datos). MapLibre la muestra por defecto con `AttributionControl`; no ocultarla.
- **CSP** (si se configura en Vercel): permitir `worker-src blob:` y `connect-src https://tiles.openfreemap.org`.
- **Nombres en español**: en el estilo, usar `['coalesce', ['get', 'name:es'], ['get', 'name']]` en las capas de texto (por ejemplo, para que aparezca "Islas Malvinas"). Falta verificar que los tiles traigan `name:es` en todas las zonas.
- Ya no hace falta proyecto ni facturación en Google Cloud para los mapas.

## 4. Lo que MapLibre no trae

| Necesidad                               | Solución                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Buscar dirección (hoy Google Places)    | **Photon** (Komoot, gratis, con autocompletado). Nominatim solo para uso esporádico: 1 consulta/seg y no permite autocompletar |
| Dibujar a mano un recorrido o perímetro | `terra-draw` o `maplibre-gl-draw`, solo si se pide esa función                                                                 |
| Ruta calle por calle                    | OSRM u OpenRouteService. Para rondas alcanza con unir los puntos con líneas rectas                                             |

## 5. Funcionalidades disponibles para rondas

Incluidas en MapLibre, sin plugins:

- Puntos de control: capa `circle` o `symbol` (íconos) desde una fuente GeoJSON.
- Recorrido de la ronda: capa `line` que une los puntos en orden.
- Perímetro del predio: capa `fill`.
- Marcadores arrastrables, popups, `fitBounds`, _clustering_ y mapa de calor (por ejemplo, de incidentes).

## 6. Riesgos

- **OpenFreeMap sin SLA.** Si se cae, el mapa queda vacío, pero el resto de la pantalla sigue andando. Mitigación: la URL vive en `VITE_MAP_STYLE_URL`; se puede pasar a MapTiler (plan gratis con clave) o a un hosting propio con Protomaps (PMTiles).
- **Privacidad.** El proveedor de tiles ve qué zona se está mirando, aunque no recibe las coordenadas de los vigiladores. El hosting propio elimina este riesgo si hiciera falta.
- **App móvil (a futuro).** Si se agrega un mapa: `@maplibre/maplibre-react-native` necesita development build y su config plugin (Expo Go no sirve). Permite mapas sin conexión, que encaja con el modo sin señal. Falta verificar la compatibilidad con Expo SDK 57.

## 7. Alternativa: mapa base del IGN (Argenmap)

El Instituto Geográfico Nacional publica su mapa base oficial como tiles gratuitos (licencia CC BY 4.0 según su documentación; confirmar el texto vigente):

```
https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG%3A3857@png/{z}/{x}/{y}.png
```

En MapLibre se carga como fuente `raster` con `scheme: 'tms'` y atribución al IGN.

**No se elige como mapa principal** porque son imágenes PNG (no se pueden recolorear para el modo oscuro, se ven menos nítidas al hacer zoom), no tiene un estilo para MapLibre y es un servidor público sin garantía de disponibilidad. OpenFreeMap ya cubre lo necesario.

**Casos donde podría convenir:**

- Clientes con **predios rurales** donde OpenStreetMap esté incompleto: el IGN podría tener mejor cartografía en esas zonas (comparar antes de decidir).
- Clientes del **sector público** que exijan cartografía oficial argentina, con la representación oficial de Malvinas y la Antártida.
- **Fondo alternativo** seleccionable (claro u oficial) o respaldo si OpenFreeMap no responde.

Como la fuente del mapa es una variable de entorno, sumarlo después no requiere rediseño.

## 8. Fuentes

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [react-maplibre (vis.gl)](https://visgl.github.io/react-maplibre) · [react-map-gl](https://github.com/visgl/react-map-gl)
- [OpenFreeMap](https://openfreemap.org) · [repositorio](https://github.com/hyperknot/openfreemap)
- [MapLibre React Native + Expo](https://maplibre.org/maplibre-react-native/docs/setup/expo)
- [Argenmap: capas base del IGN](https://mintlify.wiki/ign-argentina/argenmap/features/map-layers) · [endpoint TMS (foro Kobo Toolbox)](https://community.kobotoolbox.org/t/add-map-provider-to-dashboard/68026) · [licencia IGN (ticket JOSM)](https://josm.openstreetmap.de/ticket/15010)
