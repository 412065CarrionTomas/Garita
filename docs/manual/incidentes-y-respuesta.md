# Incidentes y respuesta

Entrá a **Incidentes y respuesta**, junto a Cumplimiento. Como administrador ves todos los predios de tu empresa; como supervisor, solo los asignados.

Elegí Desde y Hasta (el día Hasta no se incluye), predio y cliente; pulsá **Consultar reportes**. También podés usar Hoy, 7 días o 30 días. Las fechas y las franjas se muestran en la zona horaria de tu empresa. El período máximo es doce meses y, al abrir, se consulta el último mes hasta el inicio de hoy.

Los gráficos muestran incidentes por tipo, franja de dos horas, predio y clasificación actual. Debajo de cada gráfico hay una tabla con los mismos datos. El aviso de pendientes informa cuántos quedan por clasificar y cuánto lleva esperando el más antiguo de ese período; **Abrir cola de clasificación** lleva a la cola actual.

En **Tiempos de respuesta** se ven promedio, máximo, cantidad con respuesta, sin respuesta y pánicos escalados. El pánico se mide desde que se envió: un SMS enviado a las 03:10, recibido a las 03:25 y confirmado a las 03:27 tiene 17 minutos de respuesta. Las rondas se miden desde el aviso hasta la primera lectura de un supervisor; los incidentes, desde su recepción hasta la primera clasificación. Una reclasificación posterior no cambia ese primer tiempo. Los eventos sin respuesta quedan fuera del promedio; «Sin datos» significa que todavía no hay respuestas para calcularlo.

El administrador ve la comparación por persona; el supervisor ve **Tus tiempos** y los totales de sus predios. Son indicadores del equipo para mejorar la atención, no una sanción.

Los gráficos de pánico separan emergencia real, falsa alarma, prueba y sin resolver, además de Internet y SMS. La proporción de falsas alarmas se calcula sobre todas las alertas del período, incluidas las sin resolver.

Seleccioná una barra o el botón **Ver detalle** de su tabla para listar los registros del segmento. El listado permite Anterior y Siguiente y enlaza al incidente o a la alerta. Podés operar filtros, botones y enlaces con Tab, y activar con Enter o Espacio. Los estados están escritos y no dependen del color. Si una consulta falla, usá **Reintentar**.

## Prueba manual pendiente

- [ ] BDD 1: cargar doce incidentes en Depósito Ruta 9, siete entre 02:00 y 04:00; verificar gráfico, tabla y detalle de la franja.
- [ ] BDD 2: comprobar que envío SMS 03:10, recepción 03:25 y confirmación 03:27 produce 17 minutos.
- [ ] BDD 3: con tres pendientes y el más antiguo de hace dos días, comprobar aviso y acceso a la cola.
- [ ] Administrador: comparación por supervisor; supervisor: Tus tiempos y solo predios asignados.
- [ ] Recorrer filtros, períodos y tablas solo con teclado; seleccionar y paginar un segmento; abrir sus enlaces.
- [ ] Con lector de pantalla, comprobar títulos, tablas, rótulos, carga, error y aviso de pendientes, sin anuncios duplicados del SVG.
- [ ] Revisar claro y oscuro, contraste y foco, móvil y escritorio, y zoom al 200 %.
