# Usuarios de cliente — HU-27

## Uso para el administrador

1. Abrí **Clientes** y la ficha del cliente activo.
2. En **Usuarios del portal**, elegí **Dar acceso**. Ingresá nombre y apellido (2 a 60 caracteres), correo válido sin uso previo en Garita y, opcionalmente, cargo (hasta 80 caracteres).
3. Confirmá **Enviar invitación**. El usuario queda en **Invitación pendiente**. Garita envía mediante Resend el enlace propio de activación, válido por 72 horas. El envío es síncrono; el listado informa **Envío fallido** si el proveedor falla y permite reenviarlo.
4. La persona abre el enlace, define su contraseña mediante Firebase y entra por el panel web. Su primer ingreso consume la invitación y activa la cuenta. El rol cliente solo tiene canal web; la pantalla `/reportes` queda preparada para HU-28.
5. Revisá periódicamente **Último ingreso**, el cargo y el correo para detectar accesos que ya no corresponden. **Sin ingresos** significa que aún no hubo una autenticación registrada. La fecha se actualiza como máximo una vez por día UTC; representa actividad autenticada reciente, no cada inicio de sesión.
6. **Desactivar** bloquea el siguiente acceso, invalida invitaciones vigentes y revoca los tokens de Firebase. **Reactivar** recupera el acceso si el cliente sigue activo. **Reenviar invitación** invalida el enlace anterior. Las tres acciones requieren confirmación accesible.

El cliente asociado al usuario no se puede cambiar. Para otra organización cliente se crea otro usuario, usando un correo que no esté en uso. Al dar de baja el cliente, la confirmación informa cuántos usuarios se desactivarán: todos quedan desactivados, sus invitaciones se invalidan y sus predios quedan inactivos dentro de la misma transacción. La cascada bloquea el ingreso desde el guard, aunque un token de Firebase siga vigente; no llama a Firebase por cada usuario.

## API y permisos

Prefijo `/api/v1`; documentación OpenAPI en `/api/docs`.

| Método y ruta                            | Resultado                                       | Permiso                            |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| `GET /clientes/:id/usuarios`             | Usuarios, estado, cargo, envío y último ingreso | Administrador                      |
| `POST /clientes/:id/usuarios`            | Alta `invitation_pending` e invitación de 72 h  | Administrador                      |
| `POST /usuarios/:id/desactivar`          | Desactivación e invalidación de invitaciones    | Administrador                      |
| `POST /usuarios/:id/reactivar`           | Reactivación con cliente activo                 | Administrador                      |
| `POST /usuarios/:id/reenviar-invitacion` | Nueva invitación y reemplazo de las anteriores  | Administrador                      |
| `GET /predios`                           | Predios activos del cliente autenticado         | Cliente, administrador, supervisor |

El alta admite únicamente `firstName`, `lastName`, `email` y `position` opcional. El cliente sale del path y el rol se fija en el servicio. Entradas inválidas dan 400; correo usado o cliente inactivo, 409; sin token, 401; supervisor, 403; recurso de otra empresa, 404. La empresa siempre proviene del contexto autenticado.

`User.clientId` es opcional para el personal y obligatorio para el rol `client`; el servicio prueba ambas direcciones de esa regla. La relación tiene índice y `onDelete: Restrict`. Los usuarios precargados de rol cliente se asocian al cliente de su empresa al ejecutar el seed. No se adivina un cliente para usuarios existentes al migrar: un usuario cliente sin asociación queda sin acceso hasta corregir sus datos.

El filtro central de `tenantPrisma` conserva el aislamiento por empresa, impone `clientId` y exige predio y cliente activos incluso si el query solicita otro cliente o inactivos. El perfil y las invitaciones del cliente se restringen a su propio usuario; otros modelos del portal quedan denegados hasta definir sus permisos en HU-28. El alta y la reactivación bloquean la fila del cliente para serializarse con la baja y evitar accesos habilitados después de ella.

Las altas, bajas individuales, reactivaciones y bajas en cascada registran `actorUserId` y `userId` mediante Logger. La auditoría durable en tabla queda para E6 (`shortcut:` en código). No se registran tokens ni ubicaciones.

## Verificación

- `apps/api/test/client-users.e2e-spec.ts`: alta, vigencia, canje, canal web, correo repetido, validaciones, asociación inmutable, predios propios, último ingreso diario, desactivación/reactivación/reenvío, cascada y permisos.
- `apps/api/test/app.e2e-spec.ts`: nuevos endpoints sin token, supervisor y otra empresa.
- `apps/api/src/modules/prisma/tenant-prisma.spec.ts`: filtros centrales y comportamiento sin asociación.
- `apps/web/src/features/clientes/client-users-panel.test.tsx`: alta, validaciones por campo, acciones, confirmaciones y errores.

Pendiente de comprobación con credenciales de prueba: recepción real del correo en menos de dos minutos y recorrido completo desde la bandeja hasta el panel. Las pruebas automatizadas usan fakes de Firebase y Resend y no demuestran entrega real. El contenido de reportes es HU-28.
