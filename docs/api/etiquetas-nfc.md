# API de etiquetas NFC

La especificación OpenAPI vigente está en `/api/docs` al ejecutar la API. Este archivo resume las reglas de negocio; Swagger documenta las operaciones, autenticación y respuestas HTTP. Todas las rutas usan el prefijo `/api/v1` y requieren autenticación. Solo `admin` y `supervisor` pueden acceder; el supervisor queda limitado a sus predios asignados. Los UID se normalizan como hexadecimal mayúsculo sin separadores y deben representar de 4 a 10 bytes (8 a 20 caracteres hexadecimales, longitud par).

## `GET /configuracion/predios`

Devuelve predios activos disponibles para configuración: todos los de la empresa para administrador y solo los asignados al supervisor. Cada predio trae su avance: `total` (puntos activos) y `tagged` (cuántos tienen etiqueta vigente).

## `POST /etiquetas-nfc/identificar`

Body: `{ "uid": "04:a1-02 0b" }`. Dice a qué punto pertenece una etiqueta leída: devuelve su asociación más reciente en la empresa (`status`, `kind`, `associatedAt`, `endedAt`, `checkpoint` con `id`, `name` y `position`, y `site` con `id` y `name`). `lastReadAt` es el último marcado NFC de un vigilador en ese punto desde que se asoció esa etiqueta; es `null` si nadie la marcó o si la etiqueta ya no está vigente. Una configuración segura que quedó a medias no cuenta como asociación.

| Estado | Significado                                                                           |
| ------ | ------------------------------------------------------------------------------------- |
| `200`  | Etiqueta encontrada.                                                                  |
| `400`  | UID inválido.                                                                         |
| `401`  | Token ausente o inválido.                                                             |
| `403`  | Rol sin permiso.                                                                      |
| `404`  | La etiqueta no está asociada a ningún punto de la empresa o de los predios asignados. |

## `GET /predios/:id/puntos?incluirEtiqueta=true`

Agrega `etiquetaNfc` a cada punto. Incluye `status` y `associatedAt`; el UID se incluye únicamente para administradores. Si no hay etiqueta vigente, el valor es `null`. El query acepta `true` o `false`.

## `PUT /puntos/:id/etiqueta-nfc`

Body: `{ "uid": "04:a1-02 0b", "confirmMove": false }`. La respuesta exitosa contiene el ID del registro, estado `active` y fecha de asociación. Una etiqueta nueva reemplaza la anterior del punto y conserva el historial.

| Estado | Significado                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | Asociada o ya vigente en el punto solicitado.                                                                                                                                       |
| `400`  | UID o body inválido.                                                                                                                                                                |
| `401`  | Token ausente o inválido.                                                                                                                                                           |
| `403`  | Rol sin permiso.                                                                                                                                                                    |
| `404`  | Punto inexistente, de otra empresa o fuera de los predios asignados.                                                                                                                |
| `409`  | UID vigente en otro punto de la misma empresa; el cuerpo incluye el nombre del punto y requiere reintentar con `confirmMove: true`. Un conflicto de carrera también responde `409`. |
| `422`  | UID vigente de otra empresa; mensaje `Etiqueta no disponible`, sin datos del dueño.                                                                                                 |

## `DELETE /puntos/:id/etiqueta-nfc`

Marca como `removed` la etiqueta vigente y registra usuario y fecha. Responde `404` si el punto no tiene etiqueta activa.
