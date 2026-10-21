# Incidentes de campo

El vigilador puede reportar un incidente desde un turno en curso. El evento contiene tipo, descripción, hora del dispositivo, bloque `clock` de HU-14, ubicación y cantidad de fotos. La cola de HU-13 lo entrega con UUID generado en el dispositivo; la API valida turno y asignación vigentes, calcula la hora confiable con `clockFields`, persiste el estado inicial `pending` y responde `duplicate` ante reintentos del mismo `incidentId`.

## Fotos

La app reduce cada imagen a JPEG, lado mayor de 2560 px y calidad inicial 80 %, volviendo a comprimir si excede 3 MiB. Guarda los archivos en documentos privados locales y los procesa en una cola separada, solo después de que el evento ya fue aceptado. Los fallos conservan la foto y reintentan con `computeSyncBackoff`; después de confirmar el registro, se elimina la copia local.

La subida usa un `public_id` asignado por la API y una firma Cloudinary con `type: authenticated`; las fotos no tienen entrega pública. La API verifica la credencial de turno, pertenencia al incidente, identificador autorizado y metadatos/tamaño del recurso antes de guardarlo. Cloudinary no configurado devuelve 503. La autorización y el registro de fotos usan deliberadamente solo `ShiftCredentialGuard` más `@Public()`, igual que los avisos de conexión: no aceptan token Firebase. Así, la credencial debe pertenecer al turno del incidente; una credencial de otro turno recibe 404. Cada autorización reserva un cupo hasta 15 minutos y el máximo es cinco fotos por incidente.

Los datos incluyen identidad del vigilador, ubicación y evidencia visual; deben tratarse como información sensible y consultarse solo mediante los permisos de empresa/predio. Los archivos permanecen en almacenamiento autenticado de Cloudinary; no se generan URLs públicas.

## Rutas

- `POST /api/v1/sincronizacion/eventos`: incorpora eventos `incident` al lote offline de HU-13.
- `POST /api/v1/incidentes/:id/fotos/autorizacion`: firma una carga privada para el incidente propio de la credencial.
- `POST /api/v1/incidentes/:id/fotos`: valida y registra el `public_id` autorizado.

Variables opcionales: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Sin ellas, el texto del incidente sigue sincronizando y la carga de fotos informa indisponibilidad.

Referencias: [Expo ImagePicker SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [Expo ImageManipulator SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/), [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference) y [delivery types](https://cloudinary.com/documentation/ts_how_to_view_resource_type_and_delivery_type).
