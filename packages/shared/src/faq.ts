import { LEGAL_OWNER } from './legal';
import type { UserRole } from './roles';

/** `public` es lo que se ve sin iniciar sesión; el resto, el rol del usuario. */
export type FaqAudience = 'public' | UserRole;

export interface FaqEntry {
  id: string;
  topic: string;
  question: string;
  /** Párrafos de la respuesta. `**texto**` marca botones y pantallas. */
  answer: readonly string[];
  audiences: readonly FaqAudience[];
}

/**
 * Preguntas frecuentes de la web y de la app. Viajan dentro de cada cliente, así la app las muestra
 * sin conexión. Cada respuesta describe lo que hace la versión actual, no entregas futuras.
 */
export const faqEntries: readonly FaqEntry[] = [
  {
    id: 'what-is-garita',
    topic: 'Sobre Garita',
    question: '¿Qué es Garita?',
    answer: [
      'Garita es una herramienta de software para que las empresas de seguridad planifiquen, registren y controlen rondas de vigilancia: turnos, puntos de control con código QR o etiqueta NFC, supervisión en vivo, incidentes con fotos, botón de pánico y reportes de cumplimiento.',
      'Funciona como apoyo a la gestión operativa y de seguimiento; no presta servicios de vigilancia ni reemplaza a los servicios de emergencia ni los procedimientos internos de tu empresa.',
    ],
    audiences: ['public'],
  },
  {
    id: 'web-vs-mobile-by-role',
    topic: 'Acceso y roles',
    question: '¿Quién usa el panel web y quién usa la app móvil?',
    answer: [
      'Cada rol accede a la plataforma que le corresponde. Quien tiene rol **Vigilador** usa únicamente la app móvil para cubrir sus turnos, y quien tiene rol **Cliente** usa únicamente el panel web para consultar sus reportes.',
      'Quienes tienen rol **Administrador** o **Supervisor** trabajan desde el panel web y también pueden ingresar a la app móvil para usar el **Modo de configuración** y asociar etiquetas NFC en los predios.',
    ],
    audiences: ['public', 'admin', 'supervisor', 'client', 'guard'],
  },
  {
    id: 'activate-account-from-invitation',
    topic: 'Acceso y roles',
    question: '¿Cómo activo mi cuenta desde una invitación?',
    answer: [
      'El acceso a Garita es únicamente por invitación del administrador de tu empresa. Abrí el enlace **Activar cuenta** que recibiste por correo dentro de las 72 horas desde su envío; no hay registro libre.',
      'En **Activar cuenta**, marcá la casilla de aceptación de los **Términos y Condiciones** y la **Política de Privacidad**, tocá **Aceptar y continuar** y luego elegí **Definir contraseña**.',
      'Si tu rol es **Vigilador**, una vez creada tu contraseña ingresá desde la app móvil. Si el enlace venció, fue reemplazado o no es válido, pedile una nueva invitación a tu administrador; si ya se usó, ingresá con tu cuenta.',
    ],
    audiences: ['public'],
  },
  {
    id: 'how-to-sign-in',
    topic: 'Acceso y roles',
    question: '¿Cómo inicio sesión en Garita?',
    answer: [
      'Abrí el panel web o la app móvil según tu rol. En **Iniciar sesión**, completá tu **Correo electrónico** y tu **Contraseña**, y tocá **Ingresar**.',
      'En la app móvil podés usar **Mostrar** junto al campo de contraseña para revisar lo que escribiste. Cada cuenta es personal e intransferible y requiere haber activado primero tu invitación.',
    ],
    audiences: ['public'],
  },
  {
    id: 'forgot-password',
    topic: 'Acceso y roles',
    question: '¿Qué hago si olvidé mi contraseña?',
    answer: [
      'En la pantalla **Iniciar sesión**, tanto del panel web como de la app móvil, tocá **Olvidé mi contraseña**.',
      'En **Recuperar contraseña**, ingresá tu **Correo electrónico** y tocá **Enviar enlace**. Si el correo está registrado, te llegará un enlace para crear una contraseña nueva; revisá también la carpeta de spam y luego usá **Volver a ingresar**.',
    ],
    audiences: ['public'],
  },
  {
    id: 'cannot-sign-in',
    topic: 'Acceso y roles',
    question: '¿Por qué no puedo iniciar sesión?',
    answer: [
      'Si ves el aviso de correo o contraseña incorrectos, revisá tus datos o usá **Olvidé mi contraseña**. Si hiciste demasiados intentos seguidos, esperá un momento antes de volver a probar, y verificá tu conexión a internet.',
      'Si aparece que tu usuario no está habilitado, puede faltarte activar la invitación desde el correo o tu cuenta fue desactivada por tu empresa; en ese caso, contactá a tu administrador.',
      'También puede corresponderte la otra plataforma: si un **Vigilador** intenta entrar a la web, Garita avisa que su usuario se usa desde la app móvil; si un **Cliente** entra a la app, avisa que se usa desde el panel web.',
    ],
    audiences: ['public'],
  },
  {
    id: 'terms-and-privacy',
    topic: 'Privacidad y legales',
    question: '¿Dónde consulto los Términos y Condiciones y la Política de Privacidad?',
    answer: [
      'Podés leer los **Términos y Condiciones** y la **Política de Privacidad** desde los enlaces al pie de **Iniciar sesión**, tanto en el panel web como en la app móvil (en la app se pueden consultar incluso sin conexión).',
      `Cuando cambia la versión vigente, Garita pide aceptarla al ingresar con **Aceptar y continuar** en la web o **Leí y acepto** en la app, sin bloquear alertas de pánico ni un turno ya en curso. Para consultas escribí a ${LEGAL_OWNER.email}.`,
    ],
    audiences: ['public', 'admin', 'supervisor', 'client', 'guard'],
  },
  {
    id: 'trial-and-subscription',
    topic: 'Suscripción',
    question: '¿Cómo paso de la prueba a una suscripción?',
    answer: [
      'Como administrador, tenés una única prueba de 14 días para tu empresa. El banner te muestra los días restantes y el enlace **Suscribirme**. Desde **Suscripción y cobros**, elegí un plan, ingresá el email de tu cuenta de Mercado Pago y tocá **Suscribirme** para autorizar el débito mensual.',
      'Durante la prueba podés elegir **Seguir con la prueba**, que difiere el primer cobro hasta la fecha indicada, o **Pagar ahora**, que termina los días restantes. Completá la autorización en la pestaña de Mercado Pago y volvé al panel para consultar el estado.',
    ],
    audiences: ['admin'],
  },
  {
    id: 'invite-staff-and-guard-capacity',
    topic: 'Personal',
    question: '¿Cómo invito personal y qué consume el cupo de vigiladores?',
    answer: [
      'Como administrador, abrí **Personal**, tocá **Invitar usuario**, completá los datos, elegí **Vigilador** o **Supervisor** y confirmá con **Enviar invitación**. Si la invitación sigue pendiente, podés usar **Reenviar invitación**. El supervisor puede consultar el listado, pero no invitar ni modificar usuarios.',
      'Los vigiladores activos y con invitación pendiente consumen cupo; los desactivados y los supervisores no. La prueba usa el cupo del plan básico. Si alcanzás el límite al invitar o reactivar, el panel muestra el motivo y ofrece **Suscribirme** o **Cambiar de plan**, según tu cuenta.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'deactivate-guard',
    topic: 'Personal',
    question: '¿Qué pasa con los turnos cuando desactivo a un vigilador?',
    answer: [
      'Como administrador, usá **Desactivar** en **Personal**. Si tiene turnos futuros, elegí **Derivar turnos a** otro vigilador o **Dejar los turnos sin vigilador** y confirmá la cantidad afectada. Si algunos turnos no pudieron derivarse por cruces de horario, revisalos para recuperar la cobertura.',
      'Si tiene un turno en curso, el panel te advierte antes de continuar. Para usar **Desactivar igual**, tenés que completar **Motivo de desactivación**. Esa decisión cierra anticipadamente el turno y lo deja sin cobertura.',
    ],
    audiences: ['admin'],
  },
  {
    id: 'clients-and-portal-access',
    topic: 'Clientes',
    question: '¿Cómo registro un cliente y le doy acceso al portal?',
    answer: [
      'Como administrador, abrí **Clientes**, elegí **Nuevo cliente**, completá sus datos y tocá **Registrar cliente**. En su ficha podés consultar los datos de contacto y los predios activos. Desde **Usuarios del portal**, tocá **Dar acceso** para invitar a una persona del cliente.',
      'Solo el administrador puede abrir **Clientes**. También son exclusivos de ese rol **Resumen**, **SMS recibidos** y **Suscripción y cobros**.',
    ],
    audiences: ['admin'],
  },
  {
    id: 'sites-and-supervisor-assignment',
    topic: 'Predios',
    question: '¿Qué puedo gestionar en Predios según mi rol?',
    answer: [
      'En **Predios**, el administrador puede crear y editar predios, darlos de baja y elegir sus **Supervisores asignados**. Cada predio pertenece a un cliente. Como supervisor, ves los predios que tenés asignados y podés trabajar con sus rondas; el alta, la baja y la asignación de supervisores quedan a cargo del administrador.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'checkpoint-qr-and-nfc',
    topic: 'Puntos y etiquetas',
    question: '¿Cómo preparo los puntos de control y sus etiquetas?',
    answer: [
      'En **Predios**, abrí **Puntos de control**. El administrador puede usar **Agregar punto**, indicar ubicación y radio de tolerancia, y guardar con **Crear punto**. También puede descargar un sticker individual o usar **Descargar stickers de todos** para imprimir los QR.',
      'Si usás **Regenerar QR**, el código anterior deja de ser válido: imprimí y colocá el nuevo sticker. El supervisor puede consultar los puntos, pero estas acciones del panel son exclusivas del administrador.',
      'Para asociar NFC, usá la app móvil con un teléfono compatible y conexión a internet: entrá a **Modo de configuración** y elegí **Asociar etiqueta** o **Reemplazar etiqueta**. Pueden hacerlo el administrador y el supervisor en sus predios asignados.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'rounds-and-time-windows',
    topic: 'Rondas',
    question: '¿Cómo configuro una ronda y sus ventanas?',
    answer: [
      'En **Predios**, abrí **Rondas** y completá **Nueva ronda**: nombre, frecuencia, inicio y fin de franja, gracia y puntos en orden de recorrido. Revisá la **Vista previa de ventanas** y tocá **Guardar ronda**. Pueden hacerlo administradores y supervisores en los predios que pueden gestionar.',
      'Una franja que termina antes de empezar cruza medianoche; si ambos horarios son iguales, abarca 24 horas. Al editar una ronda, los cambios se aplican a los turnos futuros. Podés ordenar los puntos con las flechas y dar de baja una ronda con **Dar de baja**.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'create-and-assign-shifts',
    topic: 'Turnos',
    question: '¿Puedo crear un turno sin vigilador y asignarlo después?',
    answer: [
      'Sí. Como administrador o supervisor, abrí **Turnos** y elegí **Nuevo turno**. Indicá el predio, las fechas, los horarios y las rondas; podés dejar **Sin vigilador** y tocar **Guardar turno**. Después, desde el listado, usá **Asignar vigilador**. También podés elegir una persona con invitación pendiente, que aparece identificada junto a su nombre.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'weekly-shift-schedules',
    topic: 'Programaciones',
    question: '¿Cómo repito una guardia todas las semanas?',
    answer: [
      'En **Turnos**, entrá a **Programaciones** y elegí **Nueva programación**. Seleccioná predio, vigilador, días de la semana, horarios, fechas y al menos una ronda. Cada período admite hasta tres meses de calendario. Tocá **Previsualizar** y revisá los cruces de horario antes de **Confirmar programación**: los turnos con conflicto no se generan.',
      'Administradores y supervisores pueden **Modificar**, **Extender** o **Cancelar programación**. Los horarios usan la zona de la empresa. Los feriados y esquemas rotativos se cargan como turnos individuales.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'live-supervision',
    topic: 'Supervisión',
    question: '¿Qué información encuentro en En vivo?',
    answer: [
      'Administradores y supervisores pueden abrir **En vivo** para consultar los turnos de hoy, su vigilador, estado y avance de ventanas. Podés filtrar por **Todas**, **Tardías** o **Sin señal**. Tocá el nombre del predio para abrir el detalle y revisar **Rondas y ventanas**, **Recorrido**, **Registros** e **Historial de asignaciones**.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'review-round-records',
    topic: 'Rondas en revisión',
    question: '¿Cómo resuelvo una ronda en revisión?',
    answer: [
      'Como administrador o supervisor, abrí **Rondas en revisión** y tocá **Ver detalle**. Revisá los puntos registrados y las observaciones. Si corresponde aceptar la ventana, elegí **Validar ventana**; para corregir un registro particular, usá **Invalidar** o **Restituir**, según su estado.',
      'Cada decisión requiere un comentario de entre 5 y 500 caracteres. La acción, el comentario, la persona y la fecha quedan en **Historial de decisiones**.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'incident-visibility-and-classification',
    topic: 'Incidentes',
    question: '¿Cómo decido qué incidentes ve el cliente?',
    answer: [
      'En **Incidentes**, abrí **Por clasificar** y elegí un incidente. Tocá **Clasificar**, elegí **Interno** o **Visible al cliente**, completá **Comentario interno** y confirmá con **Confirmar clasificación**. Si lo hacés visible, podés agregar una **Nota para el cliente (opcional)**.',
      'Como supervisor, tu cola muestra pendientes de los predios asignados; como administrador, muestra los de predios sin supervisor activo. Para consultar el resto que te corresponde, usá **Ver todos los incidentes**.',
      'Podés usar **Reclasificar** para cambiar una decisión anterior. Completá **Motivo del cambio** y confirmá con **Cambiar clasificación**; la decisión y su autor quedan en el historial.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'attend-panic-alerts',
    topic: 'Alertas de pánico',
    question: '¿Cómo atiendo y resuelvo una alerta de pánico, incluso si llegó por SMS?',
    answer: [
      'Como administrador o supervisor destinatario, abrí **Alertas de pánico** y revisá el detalle. Tocá **Confirmar alerta** para indicar que la estás atendiendo. Si el vigilador tiene teléfono registrado, aparece la opción para llamarlo.',
      'Después de confirmar, elegí **Resolver alerta**, seleccioná **Emergencia real**, **Falsa alarma** o **Prueba**, escribí un comentario de entre 5 y 1.000 caracteres y tocá **Guardar resolución**. Quedan registrados el resultado, el comentario, la persona y la hora.',
      'El detalle identifica si llegó por internet o SMS y distingue la hora de envío de la recepción. Si muestra **No verificada. Atendé la alerta igualmente.**, atendela y verificá su origen según el procedimiento de tu empresa.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'inbound-sms-history',
    topic: 'SMS recibidos',
    question: '¿Dónde reviso los SMS recibidos por la empresa?',
    answer: [
      'Solo el administrador puede abrir **SMS recibidos**. Podés filtrar por **Válido**, **No verificado** o **Desconocido**, revisar el origen, el texto y las horas de recepción. Cuando un mensaje tiene una alerta asociada, aparece **Ver alerta**. Que un SMS figure en el historial no significa que haya generado una alerta de pánico.',
    ],
    audiences: ['admin'],
  },
  {
    id: 'notices-and-notification-preferences',
    topic: 'Avisos',
    question: '¿Abrir un aviso lo resuelve? ¿Puedo silenciar sus notificaciones?',
    answer: [
      'No. En **Avisos**, administradores y supervisores pueden consultar **Abiertos** y **Resueltos** y filtrar por tipo y predio. Abrir un aviso registra tu lectura, pero no lo resuelve. El estado **Visto** corresponde a tu usuario.',
      'En **Preferencias de notificación**, podés cambiar **Notificarme los turnos no iniciados**. Esa elección afecta tus notificaciones push; el aviso sigue apareciendo en el panel. Los demás avisos no se pueden silenciar desde esta pantalla.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'compliance-and-response-reports',
    topic: 'Cumplimiento y reportes',
    question: '¿Cómo consulto el cumplimiento y lo comparto?',
    answer: [
      'Como administrador o supervisor, abrí **Cumplimiento**, elegí **Desde** y **Hasta (sin incluir)** y combiná los filtros de predio, cliente y vigilador. Tocá **Consultar cumplimiento**. Las rondas en revisión y las pendientes de sincronizar se muestran aparte, fuera del porcentaje. Podés descargar el resultado con **Exportar a PDF**, dentro del período permitido por el panel.',
      'En **Incidentes**, elegí **Reporte de respuesta** para consultar **Incidentes y respuesta**, con información sobre los incidentes y la atención del equipo. El administrador consulta los predios de la empresa; el supervisor, los que tiene asignados.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'suspended-account-access',
    topic: 'Cuenta suspendida',
    question: '¿Qué sigue disponible si la cuenta queda suspendida?',
    answer: [
      'La gestión habitual queda bloqueada, pero administradores y supervisores conservan accesos limitados a **Turnos en curso** y **Avisos** de turnos iniciados antes de la suspensión, mientras siga vigente el plazo para recibir sus datos. También pueden atender las alertas de pánico sin resolver de esos turnos, incluso cuando ese plazo ya terminó.',
      'El administrador mantiene acceso a **Suscripción y cobros** para gestionar la regularización. Estos accesos no habilitan nuevas altas, programaciones ni inicios de turno.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'install-panel-and-enable-notifications',
    topic: 'Panel y notificaciones',
    question: '¿Puedo instalar el panel y activar notificaciones en mi dispositivo?',
    answer: [
      'Sí. Podés instalar Garita desde la opción de instalación de un navegador compatible y abrirla desde su ícono. En iPhone o iPad, usá **Compartir** y **Agregar a pantalla de inicio**; para activar notificaciones necesitás iOS 16.4 o posterior y abrir el panel instalado.',
      'En el menú de tu cuenta, elegí **Activar notificaciones** y aceptá el permiso. Repetí la activación en cada dispositivo. Si rechazaste el permiso, habilitalo en la configuración del navegador o del sistema y volvé a intentarlo.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'client-filter-reports',
    topic: 'Portal del cliente',
    question: '¿Qué puedo consultar en el portal del cliente y cómo elijo el período?',
    answer: [
      'Al ingresar al panel web accedés a **Reportes** (**Reportes de mis predios**), donde ves el cumplimiento de rondas de tus predios activos, los incidentes compartidos por tu empresa de seguridad y las emergencias reales resueltas.',
      'En **Predio**, dejá **Todos mis predios** o elegí uno. Definí **Desde** y **Hasta (sin incluir)** —por ejemplo, del 1 de octubre al 1 de noviembre para ver todo octubre— y tocá **Consultar**. Por defecto muestra el último mes y permite hasta 12 meses.',
      'Todas las fechas y horarios usan la zona horaria de tu empresa de seguridad, indicada debajo de los filtros.',
    ],
    audiences: ['client'],
  },
  {
    id: 'client-compliance-and-verification',
    topic: 'Portal del cliente',
    question: '¿Cómo se calcula el cumplimiento y qué significa En verificación?',
    answer: [
      'El porcentaje divide las rondas con estado **Completa** por todas las rondas evaluadas (**Completa**, **Incompleta** y **No realizada**). Si todavía no hay rondas evaluadas en ese período, muestra **Sin datos** en lugar de cero.',
      'Las rondas en estado **En verificación** se informan aparte y no cuentan en el porcentaje hasta que tu empresa de seguridad termina de revisarlas. Al volver a la pantalla o tocar **Consultar**, el cálculo se actualiza automáticamente.',
      'Tanto **Rondas por estado** como **Evolución diaria del cumplimiento** incluyen una tabla equivalente. Elegí un día o tocá **Ver ventanas** para ver sus horarios y estados, y usá **Anterior** y **Siguiente** cuando haya varias páginas.',
    ],
    audiences: ['client'],
  },
  {
    id: 'client-shared-incidents-and-photos',
    topic: 'Portal del cliente',
    question: '¿Qué incidentes puedo ver y cómo abro sus fotos?',
    answer: [
      'La sección **Incidentes compartidos** muestra solo los incidentes que tu empresa de seguridad marcó como visibles para vos. Cada tarjeta informa tipo de incidente, predio, fecha y hora, y la última nota publicada para el cliente.',
      'Si el incidente incluye imágenes, tocá **Ver fotos** para cargar las miniaturas y elegí una para ampliarla; usá **Cerrar foto** (o la tecla Escape) para volver y **Ocultar fotos** para cerrarlas. Si falla la carga, tocá **Reintentar fotos**.',
    ],
    audiences: ['client'],
  },
  {
    id: 'client-emergencies-response-time',
    topic: 'Portal del cliente',
    question: '¿Qué muestra la sección Emergencias y qué mide el tiempo de respuesta?',
    answer: [
      'La sección **Emergencias** incluye únicamente las alertas de pánico ya resueltas y clasificadas como emergencias reales en tus predios activos, con predio y fecha y hora de activación.',
      '**Tiempo de respuesta de la empresa** indica los segundos transcurridos desde la activación hasta que tu empresa de seguridad confirmó la recepción en la plataforma. No mide el tiempo de llegada física de una persona al lugar.',
    ],
    audiences: ['client'],
  },
  {
    id: 'client-export-pdf',
    topic: 'Portal del cliente',
    question: '¿Cómo exporto mis reportes a PDF y qué incluye el archivo?',
    answer: [
      'En **Reportes de mis predios**, elegí el predio y las fechas y tocá **Exportar a PDF** para descargar el documento. El período máximo permitido para exportar es de 3 meses.',
      'El archivo incluye el resumen de cumplimiento, rondas por estado, evolución diaria, listado de rondas del período, incidentes compartidos con su nota y emergencias reales. Las fotos no van incrustadas en el PDF y se consultan desde el portal.',
    ],
    audiences: ['client'],
  },
  {
    id: 'client-unavailable-or-empty',
    topic: 'Portal del cliente',
    question: '¿Por qué no veo datos, falta un predio o dice que el servicio no está disponible?',
    answer: [
      'Los avisos **Sin rondas evaluadas**, **Sin incidentes compartidos** o **Sin emergencias** indican que no hay información publicada para los filtros elegidos; probá otro predio o período. Si hubo un error de conexión, tocá **Reintentar**.',
      'El portal muestra solo tus predios activos. Si aparece que el servicio no está disponible temporalmente, la cuenta de tu empresa de seguridad está suspendida; en ese caso, o si falta un predio, consultá a tu empresa de seguridad.',
    ],
    audiences: ['client'],
  },
  {
    id: 'guard-permissions',
    topic: 'Permisos',
    question: '¿Qué permisos necesita la app del vigilador y para qué se usan?',
    answer: [
      'Al ingresar, Garita verifica **Ubicación precisa** (con los servicios de ubicación activados) y **Cámara**. Si falta alguno, abre **Permisos para trabajar**: tocá **Permitir** en cada tarjeta hasta ver **Permitida** y luego **Continuar**. La ubicación aproximada no alcanza.',
      'La ubicación se captura únicamente al iniciar o cerrar un turno, registrar un punto, reportar un incidente o activar pánico; no rastrea de forma continua. La cámara se usa para leer códigos QR y tomar fotos de incidentes.',
      'En Android, Garita solicita además notificaciones (para cambios de turno y pánico bloqueado) y, al iniciar un turno, ofrece el permiso de **SMS de emergencia** con **Continuar** o **Ahora no** para alertas sin datos.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-my-shifts',
    topic: 'Turnos',
    question: '¿Cómo veo mis turnos asignados y cómo cierro sesión?',
    answer: [
      'En **Mis turnos** ves tus turnos de los próximos 14 días con fecha, horario local, predio, rondas y estado (**Programado**, **En curso** o **Cancelado por suspensión**). Se actualiza al abrir, deslizando hacia abajo o con **Actualizar turnos**.',
      'Si ya tenés un turno en curso guardado en el teléfono, la app te lleva directo a ese turno. Para salir de tu cuenta usá **Cerrar sesión** en **Mis turnos**; necesitás conexión a internet para dar de baja las notificaciones de ese celular.',
      'Si intentás cerrar sesión con registros sin enviar, Garita te avisa antes de confirmar: esos registros no se borran, pero no se enviarán hasta que vuelvas a ingresar con señal.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-start-shift',
    topic: 'Turnos',
    question: '¿Cuándo y cómo inicio un turno?',
    answer: [
      'En **Mis turnos**, elegí tu turno y tocá **Iniciar turno**. Necesitás conexión a internet para iniciar: Garita verifica tu asignación, registra la hora y ubicación inicial y descarga en el celular las rondas, ventanas y puntos.',
      'En predios con señal podés iniciar desde 30 minutos antes del horario programado hasta el fin del turno; en predios sin señal, según el margen configurado por tu empresa. Si todavía es temprano, la app indica desde qué hora exacta podés iniciarlo.',
      'No podés iniciar si ya tenés otro turno en curso, si quedaron registros o fotos del turno anterior sin enviar o si faltan permisos. Si iniciás pasada la hora programada, el turno comienza igualmente e informa los minutos de inicio tardío.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-windows-and-close-shift',
    topic: 'Turnos',
    question: '¿Cómo sigo mis ventanas de ronda y cómo cierro el turno?',
    answer: [
      'Durante el turno, la pestaña **Ronda** muestra cada ronda con su ventana activa, los puntos pendientes en orden y el bloque **Cierre de turno** con el estado de cada ventana (**A tiempo**, **Tarde**, **Atrasada**, **No realizada**, **En curso** o **Pendiente**).',
      'La pantalla se actualiza cada minuto, al volver a la app y tras cada registro, incluso sin señal. Al completar todos los puntos de la ventana vigente, muestra el aviso de ronda completa.',
      'Al finalizar, tocá **Cerrar turno**. Si todavía no llegó la hora de fin, escribí un **Motivo del cierre anticipado** de al menos 3 caracteres. Podés cerrar sin señal: queda como **Cerrado, pendiente de envío** hasta sincronizar con el servidor.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-qr',
    topic: 'Escaneo de puntos',
    question: '¿Cómo registro un punto de control con código QR?',
    answer: [
      'Desde **Ronda**, tocá el botón **Escanear** seguido del nombre del próximo punto pendiente (o **Escanear código QR**) y apuntá la cámara al sticker del punto. Si hay poca luz, tocá **Linterna: OFF** para encenderla (**Linterna: ON**).',
      'Al leer el código, la app vibra, suena y confirma el punto registrado al instante, descontándolo de los pendientes sin esperar señal ni GPS. La ubicación se toma en los segundos siguientes; luego tocá **Escanear otro punto** o **Volver a la ronda**.',
      'Si falta el permiso de cámara, verás **Permiso de cámara necesario** con el botón **Habilitar cámara**, y también podrás registrar por NFC si tu celular lo admite.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-rules-and-messages',
    topic: 'Escaneo de puntos',
    question: '¿Qué significan los avisos al escanear un punto (repetido, muy pronto o inválido)?',
    answer: [
      'Si ya completaste ese punto en la vuelta actual, verás que ya está registrado y no se duplica. Entre dos pasadas por un mismo punto debe transcurrir al menos la mitad de la ventana; si es antes, la app indica desde qué hora podés volver a escanearlo.',
      'Si un punto físico pertenece a varias rondas de tu turno, un único escaneo lo cuenta en todas. Si una ventana venció pero estás dentro de los minutos de gracia, el registro se computa a esa ventana como tardío.',
      'Si leés un código de otro predio, desactualizado, no válido o una etiqueta ajena al turno, la app muestra el motivo y guarda el intento para supervisión. Si el servidor rechaza un registro al sincronizar, aparece en **Registros observados por el servidor**.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-nfc',
    topic: 'Escaneo de puntos',
    question: '¿Cómo registro puntos usando etiquetas NFC?',
    answer: [
      'Si tu celular admite NFC, podés leer etiquetas tanto desde la pantalla **Ronda** como desde el lector de cámara, incluso sin señal. Siempre podés usar el código QR del punto como alternativa.',
      'En Android, la lectura queda lista automáticamente (**Lectura de etiquetas activa**): acercá la parte trasera del teléfono a la etiqueta hasta sentir la vibración y el tono. En iPhone, tocá **Leer etiqueta** y acercá el celular a la etiqueta.',
      'Si en Android aparece **El NFC está apagado**, tocá **Abrir ajustes** para activarlo y volvé a Garita para continuar.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-offline-and-sync',
    topic: 'Sin señal y envío',
    question: '¿Cómo trabajo sin señal y cómo sé si mis registros ya se enviaron?',
    answer: [
      'Una vez iniciado el turno con conexión, podés escanear puntos (QR o NFC), reportar incidentes con fotos y cerrar el turno sin señal. Todo queda guardado en el celular y **Ronda** se actualiza de inmediato.',
      'Al recuperar señal o abrir la app, los registros pendientes se envían solos en orden y se reintentan sin límite si falla la red. Podés revisarlos en la pestaña **Envío** (pantalla **Para enviar**) y tocar **Enviar ahora** para forzar un intento.',
      'En **Ronda** también ves si estás **Sin conexión**, cuántos registros faltan enviar y la hora del último envío. Mantené la app instalada sin borrar sus datos hasta ver **Todo enviado** en **Para enviar**.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-report-incident',
    topic: 'Incidentes',
    question: '¿Cómo reporto un incidente con fotos durante el turno?',
    answer: [
      'Durante un turno en curso, abrí la pestaña **Incidente** o tocá **Reportar incidente** desde **Ronda**. Elegí el **Tipo de incidente** (como **Intrusión**, **Persona sospechosa**, **Daño a la propiedad**, **Accidente** u **Otro**).',
      'Completá **Descripción** con hasta 1.000 caracteres —es obligatoria si elegís **Otro**— y, si necesitás, agregá hasta 5 fotos con **Tomar foto** o **Elegir de galería**. Las imágenes se reducen automáticamente en el teléfono antes de enviarse.',
      'Tocá **Guardar incidente**. Podés cargarlo incluso sin señal: el incidente queda guardado y tanto los datos como las fotos se suben solos apenas vuelva la conexión.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-panic-button',
    topic: 'Botón de pánico',
    question: '¿Cómo activo el botón de pánico, en la app y con el celular bloqueado?',
    answer: [
      'Durante un turno en curso, mantené presionado dos segundos el botón circular de pánico (**Mantené** / **2 segundos**); un toque corto no activa nada. Confirma con vibración breve sin sonido, envía tu ubicación con prioridad y no se puede cancelar desde la app: si fue un error, avisá a tu supervisor.',
      'En Android con notificaciones activadas, también aparece **Turno en curso** en la pantalla bloqueada: encendé la pantalla, tocá **Pánico** y luego **Confirmar pánico** dentro de 5 segundos. En iPhone todavía no existe ese acceso bloqueado: desbloqueá el teléfono y usá el botón dentro de la app.',
      'Solo **Alerta recibida por la central** confirma recepción en el servidor y **Confirmada por el supervisor** confirma lectura. Sin esos textos, no supongas que llegó: llamá al 911 o buscá ayuda por otra vía disponible.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-panic-sms-fallback',
    topic: 'Botón de pánico',
    question: '¿Cómo funciona el pánico por SMS cuando no hay internet?',
    answer: [
      'Si activás pánico sin internet, la app intenta un SMS de respaldo de inmediato; con datos sin confirmación del servidor, lo intenta a los 8 segundos. Incluye código de turno, hora y ubicación; repetir una alerta abierta no envía otro SMS.',
      'En Android con el permiso aceptado en **SMS de emergencia**, sale en segundo plano incluso con pantalla bloqueada. En iPhone o Android sin ese permiso, se abre la pantalla de mensajes para que toques enviar manualmente; necesitás cobertura celular y línea habilitada.',
      '**SMS enviado**, **SMS entregado**, **SMS preparado, sin confirmación de entrega** y **No se pudo enviar** indican solo el estado del SMS, nunca lectura de un supervisor. Al volver internet, la alerta se reintenta hasta mostrar **Alerta recibida por la central** o **Confirmada por el supervisor**.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-reassigned-or-suspended',
    topic: 'Turnos',
    question:
      '¿Qué pasa si reasignaron mi turno, dieron de baja el predio o la cuenta está suspendida?',
    answer: [
      'Si reasignaron tu turno antes de que lo inicies, la app avisa que fue reasignado o ya no está disponible y no permite iniciarlo; consultá a tu supervisor. Si el predio se da de baja durante tu turno, el turno se cierra y recibís el aviso.',
      'Si la cuenta de tu empresa está suspendida, **Mis turnos** muestra el aviso correspondiente y no podés iniciar turnos nuevos (figuran como **Cancelado por suspensión**). Si ya tenías un turno en curso antes de la suspensión, podés completarlo, cerrarlo, sincronizar y usar pánico.',
      'Si un turno en curso indica que faltan sus datos en ese celular, no podrás registrar puntos desde ahí: comunicate con tu supervisor para saber cómo seguir.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-notifications',
    topic: 'Notificaciones',
    question: '¿Qué notificaciones recibo en la app y por qué pueden no llegarme?',
    answer: [
      'En Android, al iniciar sesión Garita registra tu celular para avisarte de cambios de turnos: turnos asignados, cambios de horario, reasignaciones, cancelaciones, resúmenes de programación y cierre por baja de predio. Al tocar el aviso, abre ese turno o **Mis turnos**.',
      'Si rechazaste el permiso, habilitalo en los ajustes del teléfono (**Garita > Notificaciones**) y verificá tener conexión a internet. También necesitás notificaciones activadas en Android si querés usar el acceso de pánico con el celular bloqueado.',
      'Por ahora, las notificaciones push de cambios de turno en la app funcionan solo en Android; en iPhone revisá **Mis turnos** y tocá **Actualizar turnos** para consultar novedades.',
    ],
    audiences: ['guard'],
  },
];

/** Sin sesión, solo lo público; con sesión, lo público y lo de su rol. */
export function faqForRole(
  role: UserRole | null,
  entries: readonly FaqEntry[] = faqEntries,
): FaqEntry[] {
  return entries.filter(
    (entry) =>
      entry.audiences.includes('public') || (role !== null && entry.audiences.includes(role)),
  );
}

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Busca en pregunta, respuesta y tema, sin distinguir mayúsculas ni tildes. */
export function searchFaq(entries: readonly FaqEntry[], query: string): FaqEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = normalize([entry.topic, entry.question, ...entry.answer].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

/** Agrupa por tema manteniendo el orden en que aparece cada tema. */
export function groupFaqByTopic(
  entries: readonly FaqEntry[],
): { topic: string; entries: FaqEntry[] }[] {
  const groups = new Map<string, FaqEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.topic);
    if (group) group.push(entry);
    else groups.set(entry.topic, [entry]);
  }
  return [...groups].map(([topic, grouped]) => ({ topic, entries: grouped }));
}
