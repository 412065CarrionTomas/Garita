# Marcas de registros sospechosos

El módulo `marcas` evalúa los registros válidos de puntos al guardarlos. Una sospecha nunca rechaza ni cambia la imputación del registro: el paso queda persistido y el sistema agrega cero o más marcas para que un administrador o supervisor pueda revisarlo.

## Tipos y gravedad

| Tipo                    | Gravedad | Regla                                                                                                                                                                                                                                                           |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `out_of_range`          | Media    | En un punto exterior, con ubicación válida y precisión de hasta 100 m, marca si `distancia GPS al punto − precisión > radio de tolerancia`.                                                                                                                     |
| `simulated_location`    | Grave    | El dispositivo informa `simulation: simulated`.                                                                                                                                                                                                                 |
| `impossible_time`       | Grave    | La distancia entre las ubicaciones configuradas de dos puntos consecutivos del turno dividida por el tiempo transcurrido supera la velocidad máxima del predio. Se omiten pares a menos de 100 m; un intervalo cero o negativo se considera velocidad infinita. |
| `location_disabled`     | Media    | El estado enviado es `disabled`, por ubicación apagada, permiso denegado o ubicación aproximada. No se aplica en puntos interiores.                                                                                                                             |
| `qr_on_tagged_point`    | Media    | Se usa QR en un punto con etiqueta NFC activa y el teléfono informa NFC `on` o `off`. El motivo diferencia `nfc_on` y `nfc_off`.                                                                                                                                |
| `location_unverifiable` | Leve     | En un punto exterior, la ubicación está activada pero no se obtuvo un fix, o la precisión supera 100 m.                                                                                                                                                         |

Los puntos interiores omiten las reglas de ubicación (`out_of_range`, `location_disabled` y `location_unverifiable`); siguen evaluando simulación, tiempo imposible y QR en punto con etiqueta. Un teléfono con `phoneNfc: unsupported` no recibe la marca de QR en punto con etiqueta; la respuesta del turno incluye `phoneWithoutNfc` como dato informativo.

La evaluación no usa el reloj actual: recibe los datos del registro y del registro anterior, por lo que es determinista. La distancia se calcula con `haversineMeters`. La velocidad máxima se guarda por predio: `walking` usa 10 km/h por defecto, `bicycle` 25, `vehicle` 60, y `custom` requiere un entero de 5 a 120 km/h.

## Persistencia y gancho

`RecordFlag` guarda empresa, registro, turno, tipo, gravedad, motivo opcional, detalles JSON y fecha de creación. La restricción única `(checkpointRecordId, type)` permite reevaluar sin duplicar marcas. Los registros existentes no se recalculan al aplicar la migración.

`CheckpointRecordsService` guarda primero el registro imputado y luego llama a `MarcasService.evaluateRecord` desde el servicio, de modo que también se evalúan los registros recibidos por lotes. El evaluador atrapa fallos de lectura o persistencia y el gancho también captura errores inesperados; un fallo queda en el log y no revierte el registro. La evaluación se mide con `performance.now()` y emite `record_flags_evaluated` con `elapsedMs`.

## Consulta y configuración

- `GET /api/v1/turnos/:id/registros?marcados=true&gravedad=grave` devuelve registros del turno con motivos, gravedad y el dato `phoneWithoutNfc`. Solo lo pueden consultar administradores y supervisores asignados al predio; los vigiladores no ven las marcas.
- `PATCH /api/v1/predios/:id/recorrido` configura `maxSpeedProfile` y, para `custom`, `maxSpeedKmh`. Puede hacerlo un administrador o el supervisor asignado al predio.

Ambos endpoints aparecen en Swagger (`/api/docs`).

## Incorporar una marca

1. Agregar el tipo y su gravedad en `packages/shared/src/marcas/types.ts`.
2. Implementar la regla pura en `packages/shared/src/marcas/evaluator.ts`, manteniendo explícitas las condiciones para puntos interiores y los datos disponibles.
3. Agregar pruebas unitarias para la regla, sus límites y los casos en los que no debe aplicarse.
4. Confirmar que `MarcasService` carga solo los datos necesarios y guarda el motivo y los detalles. El índice único y `skipDuplicates` preservan la idempotencia.
5. Actualizar esta tabla y los contratos/tests de API que exponen el tipo.

HU-14 incorporará las marcas de hora alterada y hora no verificable; HU-38, etiqueta no auténtica y lectura repetida. Esas reglas quedan fuera del evaluador de HU-15.

## Detección nativa de ubicación simulada

La app informa `location.simulation`; la API persiste ese estado y aplica `simulated_location` cuando vale `simulated`. La detección del lado del dispositivo usa el módulo nativo existente en `apps/mobile/modules/garita-native/`; en iOS requiere iOS 15 o posterior y en plataformas sin verificación disponible se informa `unavailable`.
