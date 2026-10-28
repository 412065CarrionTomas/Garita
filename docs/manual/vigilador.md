## Iniciar y cerrar un turno desde la API

La app necesita conexión para iniciar. Envía `POST /api/v1/turnos/:id/iniciar` con un UUID de evento, la hora del dispositivo y la ubicación; la API registra la hora del servidor y devuelve los puntos, rondas, ventanas y la referencia horaria necesarios para trabajar sin conexión. `GET /api/v1/turnos/:id/datos` vuelve a descargar esos datos durante un turno en curso y `GET /api/v1/turnos/:id/estado` informa la ventana actual y los puntos pendientes.

Al terminar, la app envía `POST /api/v1/turnos/:id/cerrar` con otro UUID y la hora/localización del dispositivo. Para cerrar antes del fin programado, incluye un motivo. Si la señal vuelve más tarde, puede reenviar el mismo UUID: el evento no se duplica. Los códigos de error de inicio y cierre permiten indicar turno reasignado, otro turno en curso, margen vencido y motivo anticipado faltante.
