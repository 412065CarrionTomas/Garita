# Cómo leer los estados de turnos

En **En vivo** ves los turnos de tus predios. Podés filtrar por estado o predio y abrir cada turno para ver sus asignaciones, ventanas, puntos, recorrido, registros e intentos rechazados. El indicador **Conectado** confirma que llegan cambios en vivo; **Reconectando…** indica que se perdió el canal y que la pantalla recargará los datos al volver.

| Estado                  | Qué significa                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| No iniciado             | El turno programado todavía no se inició.                                                        |
| En curso                | El vigilador inició el turno.                                                                    |
| Sin cobertura           | El turno se cerró antes de hora y falta cubrir el resto. El detalle muestra la hora y el motivo. |
| Cerrado                 | Llegó el cierre del vigilador o del administrador.                                               |
| Cerrado automáticamente | El sistema lo cerró al vencer el plazo.                                                          |
| No presentado           | Terminó el horario sin que nadie lo iniciara.                                                    |
| Sin vigilador           | No hay un vigilador vigente asignado.                                                            |
| Cancelado               | Se canceló antes de empezar.                                                                     |

El segundo estado muestra la **sincronización**: **Al día**, **Sincronizando (quedan N eventos)**, **Sin contacto desde HH:MM**, **Esperando sincronización hasta HH:MM**, **Sin sincronizar** o **Completo**. “Sin contacto” solo significa que el servidor no recibió avisos recientes; no confirma que el celular esté sin conexión, porque la app puede quedar suspendida al bloquear la pantalla.

Cada ventana de ronda muestra **Pendiente**, **En curso**, **Atrasada**, **Completa**, **Completa con demora**, **Incompleta**, **No realizada**, **Pendiente de sincronizar** o **En revisión**. Incompleta significa que hubo algunos puntos válidos; no realizada significa que no hubo ninguno. Una ventana puede mostrar además la gravedad de sus marcas. En **Registros**, activá **Solo marcados** y elegí una gravedad para ver los motivos. El recorrido se puede leer también como lista con hora y distancia, incluso si el mapa no carga.

Las acciones **Cubrir el resto** y **Asignarle uno** aparecen deshabilitadas hasta que esté disponible la reasignación.
