# Conectividad de predios (HU-34)

En la ficha de Predios, el administrador o el supervisor asignado configura la sección **Conectividad**. Elegí **Sin señal** si el vigilador debe trasladarse para enviar datos y estimá el tiempo real de traslado hasta una zona con señal (horas y minutos, hasta 12 horas). Sumá un margen para imprevistos (0 a 180 minutos; por defecto 30). Sin señal, el traslado debe ser mayor que cero; con señal se guarda en cero. El ejemplo se actualiza mientras completás los campos, con las mismas funciones compartidas que usa la API.

Con 3 horas de traslado y 20 minutos de margen, un turno de 13 a 15 puede iniciarse desde las 9:40 y debe sincronizar antes de las 18:20. El seed incluye **Campo Los Álamos**, en Seguridad Norte, con esos valores. Un valor demasiado alto demora la detección de datos pendientes; uno demasiado bajo produce avisos prematuros. Ajustalo según la experiencia del predio.

## Cálculo y persistencia

`packages/shared/src/sites/connectivity.ts` valida y calcula instantes UTC:

- `computeStartWindow(startsAt, conn)`: con señal, inicio menos 30 minutos (HU-10); sin señal, inicio menos traslado y margen.
- `computeSyncDeadline(endsAt, conn)`: fin más traslado y margen.
- El inicio es inclusivo: a las 9:40 se acepta y a las 9:00 se rechaza con `422 OUTSIDE_START_MARGIN`, `startFrom` ISO y `timezone` de la empresa. La app muestra **Podés iniciarlo desde las 09:40**. Conserva la validación local de fin vencido; la API decide la anticipación.

`Site` guarda `connectivityType`, `minutesToSignal` y `marginMinutes`. Al iniciar, la misma transacción que inicia el turno guarda esos tres campos y `syncDeadlineAt` en `Shift`. Modificar el predio después no altera ese turno, su respuesta de inicio persistida ni su plazo. Los turnos no iniciados usan la configuración vigente. Los turnos ya iniciados antes de esta migración, con snapshot nulo, mantienen los valores históricos con señal (0 de traslado y 30 de margen).

El cierre automático se programa en **max(fin + 120 minutos, syncDeadlineAt)**. El worker y el barrido de recuperación vuelven a comprobar ese plazo congelado. Con señal y margen de hasta 180 minutos se aplica la misma fórmula: el margen predeterminado 30 conserva el cierre de HU-10 a las dos horas; un margen explícito de 180 extiende el cierre a tres horas. El cierre real recibido después conserva el tratamiento de HU-10.

## API y permisos

Todas las rutas usan `/api/v1`, Firebase y roles `admin` o `supervisor` asignado. Un vigilador o cliente obtiene 403; sin token, 401; otra empresa o predio no asignado, 404. El aislamiento se resuelve mediante `tenantPrisma` y `TenantResourceService`. Cada actualización registra evento, predio, actor y configuración, sin ubicaciones ni secretos.

| Método y ruta                                        | Entrada / respuesta                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /predios/:id/conectividad`                      | `{ type, minutesToSignal, marginMinutes }`                                                                |
| `PUT /predios/:id/conectividad`                      | Mismo objeto; margen omitido usa 30; con señal normaliza traslado a 0; responde la configuración guardada |
| `GET /predios/:id/conectividad/simular?inicio=&fin=` | Instantes ISO con zona y fin posterior al inicio; responde `{ startFrom, syncDeadline }`                  |

Swagger está en `/api/docs`. El panel usa el cálculo compartido para previsualizar el borrador sin guardar; el endpoint de simulación calcula con la configuración persistida.

## Integración con HU-16

`ShiftExecutionModule` exporta `SYNC_DEADLINE_PORT`, implementado por `PrismaSyncDeadline`:

- `deadlineForSite(siteId, endsAt)` consulta la configuración vigente del predio.
- `deadlineForShift(id)` devuelve el snapshot si el turno inició, o calcula con el predio vigente si todavía no inició. Requiere contexto tenant autenticado y responde 404 ante recursos no visibles.

`GET /turnos/:id/datos` y `data.shift` del inicio incluyen `syncDeadlineAt` ISO. En `shiftOfflineDataSchema` es **opcional**, para compatibilidad con datos guardados y servidores anteriores; no cambia el envoltorio de inicio. Ambos agregados fueron confirmados por el coordinador. HU-16 puede mostrar “esperando sincronización hasta HH:MM”; sus estados y el aviso de traslado de HU-44 quedan fuera de alcance.

## Verificación manual pendiente

- Panel en claro y oscuro, a 360 px, navegación completa con Tab, etiquetas y errores leídos por lector de pantalla.
- Android e iPhone: antes de las 9:40 mostrar la hora permitida; a las 9:40 iniciar con conexión; tras cambiar margen a 60, conservar el plazo 18:20 del turno en curso.
- El prebuild temporal comprueba generación nativa; no sustituye compilación nativa ni prueba en dispositivos reales.
