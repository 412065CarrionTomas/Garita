# Incidentes de campo

El vigilador puede reportar un incidente desde un turno en curso. El evento contiene tipo, descripción, hora del dispositivo, bloque `clock` de HU-14, ubicación y cantidad de fotos. La cola de HU-13 lo entrega con UUID generado en el dispositivo; la API valida turno y asignación vigentes, calcula la hora confiable con `clockFields`, persiste el estado inicial `pending` y responde `duplicate` ante reintentos del mismo `incidentId`.

## Fotos

La app reduce cada imagen a JPEG, lado mayor de 2560 px y calidad inicial 80 %, volviendo a comprimir si excede 3 MiB. Guarda los archivos en documentos privados locales y los procesa en una cola separada, solo después de que el evento ya fue aceptado. Los fallos conservan la foto y reintentan con `computeSyncBackoff`; después de confirmar el registro, se elimina la copia local.

La subida usa un `public_id` asignado por la API y una firma Cloudinary con `type: authenticated`; las fotos no tienen entrega pública. La API verifica la credencial de turno, pertenencia al incidente, identificador autorizado y metadatos/tamaño del recurso antes de guardarlo. Cloudinary no configurado devuelve 503. La autorización y el registro de fotos usan deliberadamente solo `ShiftCredentialGuard` más `@Public()`, igual que los avisos de conexión: no aceptan token Firebase. Así, la credencial debe pertenecer al turno del incidente; una credencial de otro turno recibe 404. Cada autorización vale 15 minutos; el máximo de cinco se aplica a las fotos registradas. Al pedir otra autorización se reemplazan las más viejas sin consumir cuando ocupan los lugares disponibles, para que una subida fallida no agote el cupo. La confirmación exige una autorización vigente, todavía no reemplazada, del mismo incidente y `public_id`. Autorizaciones y confirmaciones se serializan por incidente; incluso con confirmaciones concurrentes se admiten como máximo cinco fotos reales.

Los datos incluyen identidad del vigilador, ubicación y evidencia visual; deben tratarse como información sensible y consultarse solo mediante los permisos de empresa/predio. Los archivos permanecen en almacenamiento autenticado de Cloudinary; no se generan URLs públicas.

## Rutas

- `POST /api/v1/sincronizacion/eventos`: incorpora eventos `incident` al lote offline de HU-13.
- `POST /api/v1/incidentes/:id/fotos/autorizacion`: firma una carga privada para el incidente propio de la credencial.
- `POST /api/v1/incidentes/:id/fotos`: valida y registra el `public_id` autorizado.

Variables opcionales: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Sin ellas, el texto del incidente sigue sincronizando y la carga de fotos informa indisponibilidad.

Referencias: [Expo ImagePicker SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [Expo ImageManipulator SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/), [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference) y [delivery types](https://cloudinary.com/documentation/ts_how_to_view_resource_type_and_delivery_type).

## Clasificación

Los incidentes nuevos quedan `pending` hasta que alguien los clasifique. El supervisor abre **Cola de clasificación** en el panel: ve primero el más antiguo, con un aviso textual si lleva más de 24 horas. Puede elegir **Visible para el cliente** o **Interno** y debe escribir un comentario interno de 5 a 1.000 caracteres. La nota al cliente, de hasta 500 caracteres, es opcional para los visibles. El administrador atiende la cola de los predios sin supervisores activos; la asignación se calcula al consultar, de modo que una baja o cambio de supervisor traslada los pendientes sin mover datos. El contador del menú se actualiza al consultar y después de clasificar.

En **Incidentes**, el supervisor o administrador filtra por predio, fecha, tipo y estado; abre el detalle para consultar fotos, ubicación e historial. Para cambiar una decisión usa **Reclasificar** e indica un motivo de 5 a 500 caracteres. Cada entrada de `IncidentClassification` conserva clasificación, comentario interno, nota, motivo, autor y hora. La última decisión rige en `Incident.classificationStatus`; ambos se escriben en la misma transacción. El vigilador desactivado se muestra con la indicación «(desactivado)».

Las rutas Firebase `GET /api/v1/incidentes/cola`, `/cola/cantidad`, `/incidentes`, `/incidentes/:id` y `POST /incidentes/:id/clasificar|reclasificar` admiten solo administrador y supervisor asignado; los recursos ajenos responden 404. Las fotos se entregan mediante URL de descarga autenticada de Cloudinary firmada por cinco minutos, con transformación de miniatura o archivo completo. El portal del cliente (HU-28) aún no expone una ruta: `ClientIncidentsReader` prepara exclusivamente incidentes `client_visible` de sus predios activos, con la última nota y sin comentarios internos. Los endpoints actuales responden 403 al cliente.

El listado pagina de 25 en 25 y usa índices por empresa, predio, estado y fecha de creación. La cola usa los mismos índices y las asignaciones vigentes del predio.

La fecha del filtro y la hora mostrada en la tabla, la cola y el detalle corresponden a la ocurrencia: `trustedAt` si existe, con respaldo en `occurredAtDevice` cuando no hay hora confiable. Se muestran en la zona horaria de la empresa; desde incluye la medianoche local y hasta incluye todo ese día, hasta la medianoche local siguiente, incluso al cambiar el horario de verano. `createdAt` conserva la recepción/persistencia para ordenar la cola y medir sus 24 horas de espera; no sustituye la hora del incidente.
