# API de etiquetas NFC

Todas las rutas usan el prefijo `/api/v1` y requieren autenticación. Solo `admin` y `supervisor` pueden acceder; el supervisor queda limitado a sus predios asignados. Los UID se normalizan como hexadecimal mayúsculo sin separadores y deben representar 4, 7 o 10 bytes.

## `GET /configuracion/predios`

Devuelve predios activos disponibles para configuración: todos los de la empresa para administrador y solo los asignados al supervisor.

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
