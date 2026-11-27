import { LEGAL_OWNER } from './legal';
import type { UserRole } from './roles';

/** `public` es lo que se ve sin iniciar sesión; el resto, el rol del usuario. */
export type FaqAudience = 'public' | UserRole;

export interface FaqEntry {
  id: string;
  topic: string;
  question: string;
  /** Párrafos de la respuesta; un paso numerado por párrafo. `**texto**` marca botones y pantallas. */
  answer: readonly string[];
  audiences: readonly FaqAudience[];
  /** Pantalla del panel web donde se resuelve. La app no la muestra; lo público no la lleva. */
  link?: { path: string; label: string };
  /** Para administrador y supervisor: aplica a la app móvil, que solo gestiona etiquetas NFC. */
  inApp?: true;
}

/**
 * Preguntas frecuentes de la web y de la app. Viajan dentro de cada cliente, así la app las muestra
 * sin conexión. Cada respuesta describe lo que hace la versión actual, no entregas futuras: al
 * cambiar un flujo, actualizá su pregunta. Dentro de cada audiencia, los temas van del más
 * consultado o bloqueante al menos frecuente.
 */
export const faqEntries: readonly FaqEntry[] = [
  // ── Público ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'what-is-garita',
    topic: 'Sobre Garita',
    question: '¿Qué es Garita?',
    answer: [
      'Es una herramienta para que las empresas de seguridad planifiquen y controlen rondas de vigilancia: turnos, puntos con código QR o etiqueta NFC, supervisión en vivo, incidentes con fotos, botón de pánico y reportes de cumplimiento.',
      'Es un apoyo para la gestión: no presta servicios de vigilancia ni reemplaza al 911 ni a los procedimientos de tu empresa.',
    ],
    audiences: ['public'],
  },
  {
    id: 'web-vs-mobile-by-role',
    topic: 'Sobre Garita',
    question: '¿Entro desde el panel web o desde la app móvil?',
    answer: [
      'Depende de tu rol. Si sos **Vigilador**, usás solo la app móvil; si sos **Cliente**, solo el panel web.',
      'Si sos **Administrador** o **Supervisor**, trabajás en el panel web y también podés entrar a la app para usar **Etiquetas NFC** en los predios.',
    ],
    audiences: ['public'],
  },
  {
    id: 'can-i-sign-up',
    topic: 'Acceso y cuenta',
    question: '¿Puedo crear una cuenta sin invitación?',
    answer: [
      'No. Garita no tiene registro libre: cada cuenta es personal y la crea el administrador de tu empresa de seguridad enviándote una invitación por correo.',
    ],
    audiences: ['public'],
  },
  {
    id: 'activate-account-from-invitation',
    topic: 'Acceso y cuenta',
    question: '¿Cómo activo mi cuenta desde la invitación?',
    answer: [
      '1. Abrí el enlace **Activar cuenta** del correo dentro de las 72 horas desde su envío.',
      '2. Marcá la casilla de los **Términos y Condiciones** y la **Política de Privacidad** y tocá **Aceptar y continuar**.',
      '3. Tocá **Definir contraseña** y creá tu clave. Si sos **Vigilador**, después ingresá desde la app móvil.',
    ],
    audiences: ['public'],
  },
  {
    id: 'invitation-link-problem',
    topic: 'Acceso y cuenta',
    question: '¿Qué hago si el enlace de invitación venció o no funciona?',
    answer: [
      'Pedile a tu administrador una invitación nueva si el aviso dice que venció (pasaron 72 horas), que fue reemplazada o que no es válida.',
      'Si dice que ya fue usada, ingresá con tu correo y contraseña. Si hiciste demasiados intentos, esperá un minuto; si pide una versión nueva de los términos, recargá la página.',
    ],
    audiences: ['public'],
  },
  {
    id: 'how-to-sign-in',
    topic: 'Acceso y cuenta',
    question: '¿Cómo inicio sesión en Garita?',
    answer: [
      'Abrí el panel web o la app móvil según tu rol, completá **Correo electrónico** y **Contraseña** en **Iniciar sesión** y tocá **Ingresar**.',
      'Antes tenés que haber activado tu invitación. En la app podés tocar **Mostrar** para revisar la contraseña.',
    ],
    audiences: ['public'],
  },
  {
    id: 'forgot-password',
    topic: 'Acceso y cuenta',
    question: '¿Cómo recupero mi contraseña si la olvidé?',
    answer: [
      '1. En **Iniciar sesión** (web o app), tocá **Olvidé mi contraseña**.',
      '2. Ingresá tu **Correo electrónico** y tocá **Enviar enlace**.',
      '3. Abrí el enlace que te llega (revisá también spam), creá la contraseña nueva y volvé a **Iniciar sesión**.',
    ],
    audiences: ['public'],
  },
  {
    id: 'cannot-sign-in',
    topic: 'Acceso y cuenta',
    question: '¿Por qué no puedo iniciar sesión?',
    answer: [
      'Depende del aviso. Si dice correo o contraseña incorrectos, revisalos o usá **Olvidé mi contraseña**; si hiciste demasiados intentos, esperá un momento y revisá tu conexión.',
      'Si dice que tu usuario no está habilitado, falta activar la invitación o tu cuenta fue desactivada: consultá a tu administrador. Si avisa que corresponde otra plataforma, el **Cliente** entra por la web y el **Vigilador** por la app.',
    ],
    audiences: ['public'],
  },
  {
    id: 'terms-and-privacy',
    topic: 'Privacidad y legales',
    question: '¿Dónde leo los Términos y Condiciones y la Política de Privacidad?',
    answer: [
      'En los enlaces al pie de **Iniciar sesión**, en la web y en la app. Con sesión iniciada en la app también están en el menú lateral, y se leen sin conexión.',
      `Por consultas sobre privacidad o tus datos, escribí a ${LEGAL_OWNER.email}.`,
    ],
    audiences: ['public'],
  },
  {
    id: 'accept-updated-terms',
    topic: 'Privacidad y legales',
    question: '¿Por qué me pide aceptar los Términos y Condiciones al ingresar?',
    answer: [
      'Porque cambió la versión vigente. En la web marcá la casilla y tocá **Aceptar y continuar**; en la app tocá **Leí y acepto**.',
      'Mientras tanto no se bloquean un turno en curso ni **Alertas de pánico**. Si avisa que hay una versión más nueva, recargá la página o actualizá la app.',
    ],
    audiences: ['public'],
  },

  // ── Administrador y supervisor: operación diaria ─────────────────────────────────────────
  {
    id: 'panic-attend-and-resolve',
    topic: 'Alertas de pánico',
    question: '¿Cómo atiendo y resuelvo una alerta de pánico?',
    answer: [
      '1. Abrí la alerta desde el aviso rojo **Atender alerta** o en **Pendientes** > **Alertas de pánico**.',
      '2. Tocá **Confirmar alerta** para avisar que la estás atendiendo. Si el vigilador tiene teléfono cargado, aparece **Llamar al vigilador**.',
      '3. Tocá **Resolver alerta**, elegí **Emergencia real**, **Falsa alarma** o **Prueba**, escribí un **Comentario** (5 a 1.000 caracteres) y tocá **Guardar resolución**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/alertas-panico', label: 'Alertas de pánico' },
  },
  {
    id: 'panic-sound-and-escalation',
    topic: 'Alertas de pánico',
    question: '¿Qué pasa si nadie confirma una alerta de pánico?',
    answer: [
      'A los 2 minutos sin confirmar, Garita la escala y envía SMS a los administradores con teléfono cargado y a los supervisores del predio.',
      'Hasta que alguien toca **Confirmar alerta**, el panel suena y muestra el cartel **Alerta de pánico** arriba. Puede resolverla cualquier persona con acceso al predio, aunque la haya confirmado otra.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/alertas-panico', label: 'Alertas de pánico' },
  },
  {
    id: 'panic-sms-unverified',
    topic: 'Alertas de pánico',
    question: '¿Qué significa que una alerta llegó por SMS o figura como No verificada?',
    answer: [
      '**Por SMS** indica que el vigilador la envió sin internet; el detalle separa la hora de envío de la hora en que llegó.',
      '**No verificada** (o **El número no coincide**) indica que el teléfono o el código del turno no coinciden. Atendela igual y confirmá su origen según el protocolo de tu empresa.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/alertas-panico', label: 'Alertas de pánico' },
  },
  {
    id: 'live-supervision',
    topic: 'En vivo',
    question: '¿Qué veo en En vivo?',
    answer: [
      'Los turnos de hoy (y los nocturnos todavía activos) en una tabla y en el mapa, con su vigilador, estado y avance. Se actualiza sola y se filtra por **Todas**, **Tardías** o **Sin señal**.',
      'Tocá el nombre del predio para ver **Rondas y ventanas**, **Recorrido**, **Registros**, **Intentos rechazados** e **Historial de asignaciones**. El supervisor ve solo sus predios asignados.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/supervision', label: 'En vivo' },
  },
  {
    id: 'live-reassign-shift',
    topic: 'En vivo',
    question: '¿Cómo reasigno un turno en curso o cubro el resto?',
    answer: [
      'Abrí el turno desde **En vivo** y tocá **Reasignar** o **Cubrir el resto**. Elegí un vigilador disponible y la hora de inicio; si la dejás vacía, corre desde ahora.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/supervision', label: 'En vivo' },
  },
  {
    id: 'live-close-without-data',
    topic: 'En vivo',
    question: '¿Qué hago si un turno terminó y sus datos nunca llegaron?',
    answer: [
      'Abrí el turno y tocá **Cerrar sin datos**. Escribí un **Motivo del cierre** (5 a 500 caracteres) y marcá **Confirmo el cierre sin datos de este turno**.',
      'Las ventanas pendientes pasan a no realizadas. Si los datos llegan después, Garita los evalúa igual.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/supervision', label: 'En vivo' },
  },
  {
    id: 'notices-open-and-resolve',
    topic: 'Avisos',
    question: '¿Abrir un aviso lo resuelve?',
    answer: [
      'No. Abrirlo lo marca como **Visto** solo para vos; el aviso sigue abierto.',
      'Se resuelve cuando se corrige la causa (por ejemplo, inicia el turno o llegan los datos) o cuando actuás desde el aviso con **Reasignar turno**, **Cubrir el resto**, **Asignar vigilador** o **Cerrar sin datos**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/avisos', label: 'Avisos' },
  },
  {
    id: 'notification-preferences-mute',
    topic: 'Avisos',
    question: '¿Puedo silenciar las notificaciones de algunos avisos?',
    answer: [
      'Solo las de turnos no iniciados. En tu menú de usuario abrí **Preferencias de notificación** y desactivá **Notificarme los turnos no iniciados**.',
      'El aviso sigue apareciendo en **Avisos**. Los demás no se pueden silenciar porque indican un predio sin cobertura.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/avisos/preferencias', label: 'Preferencias de notificación' },
  },
  {
    id: 'review-round-records',
    topic: 'Rondas en revisión',
    question: '¿Cómo resuelvo una ronda en revisión?',
    answer: [
      '1. En **Pendientes** > **Rondas en revisión**, elegí una ventana de la lista.',
      '2. Revisá las lecturas marcadas y elegí **Validar ventana**, o corregí lecturas con **Invalidar**, **Restituir** o **Invalidar los N**.',
      '3. Completá **Motivo (queda en el historial)** (5 a 500 caracteres) y confirmá. La decisión queda en **Historial de decisiones**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/revision', label: 'Rondas en revisión' },
  },
  {
    id: 'review-resolved-history',
    topic: 'Rondas en revisión',
    question: '¿Dónde veo las rondas que ya se revisaron?',
    answer: [
      'En **Rondas en revisión**, cambiá el estado a **Resueltas**. Sin fechas elegidas, muestra los últimos 30 días.',
      'Podés buscar por ronda, predio o vigilador. Si hay más de 200 ventanas, muestra las primeras 200: acotá por fechas o predio.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/revision?estado=resueltas', label: 'Rondas resueltas' },
  },
  {
    id: 'incident-classify-visibility',
    topic: 'Incidentes',
    question: '¿Cómo decido si el cliente ve un incidente?',
    answer: [
      '1. En **Incidentes** > **Bandeja y archivo**, vista **Por clasificar**, elegí el incidente y tocá **Clasificar**.',
      '2. Elegí **Interno** o **Visible al cliente**, la **Gravedad** y escribí el **Comentario interno** (5 a 1.000 caracteres). Si es visible, podés sumar una **Nota para el cliente (opcional)**.',
      '3. Tocá **Confirmar y seguir**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/incidentes', label: 'Bandeja de incidentes' },
  },
  {
    id: 'incident-queue-by-role',
    topic: 'Incidentes',
    question: '¿Por qué no veo todos los incidentes en Por clasificar?',
    answer: [
      'Porque la bandeja reparte el trabajo: el supervisor ve los pendientes de sus predios asignados y el administrador, los de predios sin supervisor activo.',
      'Para ver el resto de los incidentes a tu alcance, cambiá a la vista **Todos**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/incidentes?vista=todos', label: 'Todos los incidentes' },
  },
  {
    id: 'incident-reclassify',
    topic: 'Incidentes',
    question: '¿Puedo cambiar la clasificación de un incidente?',
    answer: [
      'Sí. Abrí el incidente desde la vista **Todos** y tocá **Reclasificar**. Completá **Motivo del cambio** (5 a 500 caracteres) y tocá **Cambiar clasificación**.',
      'Podés cambiar visibilidad, gravedad y notas. El cambio y su autor quedan en **Bitácora**; el cliente ve siempre la última nota publicada.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/incidentes?vista=todos', label: 'Todos los incidentes' },
  },
  {
    id: 'incident-follow-up',
    topic: 'Incidentes',
    question: '¿Cómo hago el seguimiento de un incidente hasta cerrarlo?',
    answer: [
      'Al clasificarlo, marcá **Requiere seguimiento de la empresa (queda abierto hasta cerrarlo)**.',
      'En la sección **Seguimiento** de la ficha, escribí un texto (3 a 1.000 caracteres) y tocá **Agregar acción** o **Cerrar seguimiento**. Para retomarlo, usá **Reabrir seguimiento**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/incidentes?vista=todos', label: 'Todos los incidentes' },
  },

  // ── Administrador y supervisor: planificación ────────────────────────────────────────────
  {
    id: 'create-and-assign-shifts',
    topic: 'Turnos',
    question: '¿Puedo crear un turno sin vigilador y asignarlo después?',
    answer: [
      'Sí. En **Turnos** > **Listado**, tocá **Nuevo turno**, elegí predio, fechas, horarios y al menos una ronda, dejá **Sin vigilador** y tocá **Guardar turno**.',
      'Después asignalo con **Asignar** (vista **Planilla**) o **Asignar vigilador** (vista **Lista**). No se puede asignar a alguien con otro turno superpuesto.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/turnos', label: 'Turnos' },
  },
  {
    id: 'cannot-edit-started-shift',
    topic: 'Turnos',
    question: '¿Por qué no puedo editar ni cancelar un turno?',
    answer: [
      'Porque ya pasó su hora de inicio: solo se editan o cancelan antes de empezar.',
      'Para cambiar quién lo cubre, usá **Reasignar** o **Cubrir** desde **Turnos** o desde **En vivo**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/turnos', label: 'Turnos' },
  },
  {
    id: 'weekly-shift-schedules',
    topic: 'Programaciones',
    question: '¿Cómo repito una guardia todas las semanas?',
    answer: [
      '1. En **Turnos** > **Programaciones**, tocá **Nueva programación**.',
      '2. Elegí predio, vigilador, días, horarios, fechas **Desde** y **Hasta (incluido)** (hasta tres meses) y al menos una ronda.',
      '3. Revisá la **Vista previa**: los días con cruces de horario no se generan. Tocá **Confirmar programación**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/programaciones-turnos', label: 'Programaciones' },
  },
  {
    id: 'modify-extend-or-cancel-schedule',
    topic: 'Programaciones',
    question: '¿Qué pasa con los turnos si modifico o cancelo una programación?',
    answer: [
      '**Modificar** regenera solo los turnos futuros que no editaste a mano. **Extender** agrega hasta tres meses más desde el fin actual.',
      '**Cancelar programación** cancela los turnos próximos sin iniciar y conserva los ya realizados. Feriados y esquemas rotativos se cargan como turnos sueltos.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/programaciones-turnos', label: 'Programaciones' },
  },
  {
    id: 'compliance-check-and-calculation',
    topic: 'Cumplimiento y reportes',
    question: '¿Cómo consulto el cumplimiento de las rondas?',
    answer: [
      'Abrí **Cumplimiento** y elegí **Hoy**, **7 días**, **30 días** o un rango **Desde**–**Hasta** (ambos incluidos, hasta 12 meses). Filtrá por predio, cliente o vigilador; se actualiza solo.',
      'El porcentaje cuenta las rondas completas, incluidas las **Con demora**. Las que están en revisión o sin enviar figuran aparte, en **Fuera del porcentaje**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/cumplimiento', label: 'Cumplimiento' },
  },
  {
    id: 'reports-export-pdf',
    topic: 'Cumplimiento y reportes',
    question: '¿Cómo descargo un reporte en PDF?',
    answer: [
      'En **Cumplimiento** o en **Incidentes** > **Reporte de respuesta**, elegí los filtros y tocá **Exportar a PDF**.',
      'El PDF admite hasta 3 meses: si el rango en pantalla es mayor, acortalo para habilitar la descarga.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/cumplimiento', label: 'Cumplimiento' },
  },
  {
    id: 'incident-response-report',
    topic: 'Cumplimiento y reportes',
    question: '¿Qué muestra el Reporte de respuesta?',
    answer: [
      'El volumen de incidentes por día, horario, tipo, predio y gravedad, los seguimientos abiertos, las alertas de pánico y los **Tiempos de respuesta** de tu equipo.',
      'El administrador compara **Por predio** o **Por supervisor**; el supervisor ve sus predios y **Mis tiempos**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/incidentes-y-respuesta', label: 'Reporte de respuesta' },
  },

  // ── Administrador y supervisor: configuración ────────────────────────────────────────────
  {
    id: 'sites-by-role',
    topic: 'Predios',
    question: '¿Qué puedo cambiar en un predio según mi rol?',
    answer: [
      'El administrador crea predios con **Nuevo predio**, los edita, los da de baja y elige sus **Supervisores asignados** en la pestaña **Configuración**.',
      'El supervisor ve solo sus predios asignados y puede gestionar sus **Rondas**, la **Conectividad** y la **Velocidad máxima de recorrido**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'site-connectivity',
    topic: 'Predios',
    question: '¿Cómo configuro un predio sin señal?',
    answer: [
      'En **Predios** > **Configuración** > **Conectividad**, elegí **Sin señal**, indicá el **Tiempo hasta zona con señal** (hasta 12 horas) y el **Margen adicional (minutos)**, y tocá **Guardar conectividad**.',
      'Esos valores definen desde cuándo puede iniciarse el turno y hasta cuándo se esperan sus datos. Aplica a los turnos que todavía no empezaron.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'site-travel-speed',
    topic: 'Predios',
    question: '¿Para qué sirve la velocidad máxima de recorrido?',
    answer: [
      'Sirve para detectar traslados imposibles entre dos puntos: si un vigilador se movió más rápido, la lectura se marca para revisar.',
      'En **Predios** > **Configuración**, elegí **A pie**, **Bicicleta**, **Vehículo** o **Personalizado** (5 a 120 km/h) y tocá **Guardar velocidad**.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'checkpoints-qr-and-stickers',
    topic: 'Puntos y etiquetas',
    question: '¿Cómo creo un punto de control e imprimo su QR?',
    answer: [
      '1. En **Predios** > **Puntos de control**, tocá **Agregar punto**, ubicalo en el mapa, indicá el radio de tolerancia (10 a 200 m) y tocá **Crear punto**.',
      '2. Descargá su QR con **Descargar sticker** o todos juntos con **Descargar stickers de todos**.',
      'Solo el administrador crea y modifica puntos; el supervisor los consulta.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'checkpoint-regenerate-or-remove',
    topic: 'Puntos y etiquetas',
    question: '¿Qué pasa si regenero el QR o doy de baja un punto?',
    answer: [
      'Con **Regenerar QR**, el sticker anterior deja de servir: imprimí y pegá el nuevo antes del próximo turno.',
      '**Dar de baja** no funciona si el punto está en una ronda activa: quitalo primero de esas rondas.',
    ],
    audiences: ['admin'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'nfc-tags-mobile-configuration',
    topic: 'Puntos y etiquetas',
    question: '¿Cómo asocio una etiqueta NFC a un punto?',
    answer: [
      '1. En la app móvil, con un celular con NFC y conexión, abrí **Etiquetas NFC** y elegí el predio.',
      '2. Tocá un punto pendiente (o **Etiquetar pendientes** para hacer varios seguidos) y apoyá la etiqueta en la parte trasera del celular hasta ver la confirmación.',
      'En un punto ya etiquetado podés usar **Reemplazar etiqueta** o **Quitar etiqueta**; para saber de qué punto es una etiqueta suelta, usá **Identificar etiqueta**.',
    ],
    audiences: ['admin', 'supervisor'],
    inApp: true,
  },
  {
    id: 'staff-mobile-scope',
    topic: 'Puntos y etiquetas',
    question: '¿Qué puedo hacer en la app móvil como administrador o supervisor?',
    answer: [
      'Solo gestionar las etiquetas NFC de los puntos desde **Etiquetas NFC**. Turnos, alertas, incidentes y reportes se manejan desde el panel web.',
    ],
    audiences: ['admin', 'supervisor'],
    inApp: true,
  },
  {
    id: 'rounds-and-time-windows',
    topic: 'Rondas',
    question: '¿Cómo configuro una ronda y sus ventanas?',
    answer: [
      '1. En **Predios** > **Rondas**, tocá **Nueva ronda** y definí **Inicio de franja**, **Fin de franja**, **Frecuencia (min)** y **Gracia (minutos)**.',
      '2. Sumá los puntos en el orden del recorrido y revisá **Ventanas (inicio–fin)**.',
      '3. Tocá **Guardar**. Si la franja termina antes de empezar, cruza medianoche; si inicio y fin son iguales, abarca 24 horas.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'edit-or-deactivate-round',
    topic: 'Rondas',
    question: '¿Los cambios en una ronda afectan los turnos ya creados?',
    answer: [
      'Solo los futuros. Al editar una ronda, el cambio aplica a los turnos programados que no empezaron; los turnos en curso y el historial no cambian.',
      'Con **Dar de baja** deja de ofrecerse para turnos nuevos, y con **Duplicar** creás otra con la misma configuración.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/predios', label: 'Predios' },
  },
  {
    id: 'invite-staff',
    topic: 'Personal',
    question: '¿Cómo invito a un vigilador o supervisor?',
    answer: [
      'En **Gestión** > **Personal**, tocá **Invitar usuario**, completá los datos, elegí **Vigilador** o **Supervisor** y tocá **Enviar invitación**.',
      'Si no llegó o figura **Envío fallido**, usá **Reenviar invitación**. Solo el administrador invita y edita; el supervisor consulta el listado.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/personal', label: 'Personal' },
  },
  {
    id: 'guard-capacity-limit',
    topic: 'Personal',
    question: '¿Qué hago si llegué al límite de vigiladores de mi plan?',
    answer: [
      'Cambiá de plan o desactivá vigiladores que ya no trabajen. El panel ofrece **Suscribirme** o **Cambiar de plan** (solo administrador).',
      'Ocupan cupo los vigiladores activos y los que tienen invitación pendiente; los desactivados y los supervisores no. Durante la prueba rige el cupo del plan básico.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/personal', label: 'Personal' },
  },
  {
    id: 'deactivate-guard',
    topic: 'Personal',
    question: '¿Qué pasa con los turnos cuando desactivo a un vigilador?',
    answer: [
      'Te pide decidir sus turnos futuros: **Derivar turnos a** otro vigilador o **Dejar los turnos sin vigilador**. Los que se superpongan con el reemplazo quedan sin vigilador.',
      'Si tiene un turno en curso, **Desactivar igual** exige un **Motivo de desactivación** y cierra ese turno, que queda sin cobertura.',
    ],
    audiences: ['admin'],
    link: { path: '/personal', label: 'Personal' },
  },
  {
    id: 'manage-clients',
    topic: 'Clientes',
    question: '¿Cómo registro un cliente?',
    answer: [
      'En **Gestión** > **Clientes**, tocá **Nuevo cliente**, completá sus datos de contacto y tocá **Registrar cliente**. Solo el administrador gestiona clientes.',
    ],
    audiences: ['admin'],
    link: { path: '/clientes', label: 'Clientes' },
  },
  {
    id: 'client-portal-access',
    topic: 'Clientes',
    question: '¿Cómo le doy acceso al portal a una persona del cliente?',
    answer: [
      'Abrí la ficha del cliente y, en **Usuarios del portal**, tocá **Dar acceso**, completá sus datos y tocá **Enviar invitación** (vale 72 horas).',
      'Desde esa tabla podés reenviar, desactivar o reactivar accesos. Solo funciona con clientes activos.',
    ],
    audiences: ['admin'],
    link: { path: '/clientes', label: 'Clientes' },
  },
  {
    id: 'deactivate-client',
    topic: 'Clientes',
    question: '¿Qué pasa si doy de baja un cliente?',
    answer: [
      'Se dan de baja sus predios, se cancelan los turnos futuros, terminan sus programaciones, se cierran los turnos en curso y se desactivan sus usuarios del portal.',
      'El panel muestra ese impacto antes de **Confirmar baja**.',
    ],
    audiences: ['admin'],
    link: { path: '/clientes', label: 'Clientes' },
  },
  {
    id: 'inbound-sms-history',
    topic: 'SMS recibidos',
    question: '¿Qué significa cada estado en SMS recibidos?',
    answer: [
      '**Válido**: coincidió con el código de un turno en curso. **No verificado**: coincidió el teléfono del vigilador, pero no el código. **Desconocido**: no coincide con ningún turno y no genera alerta.',
      'Cuando un SMS generó una alerta, tocá **Ver alerta**. Solo el administrador abre esta pantalla.',
    ],
    audiences: ['admin'],
    link: { path: '/sms-recibidos', label: 'SMS recibidos' },
  },

  // ── Administrador: suscripción ───────────────────────────────────────────────────────────
  {
    id: 'trial-and-subscription',
    topic: 'Suscripción',
    question: '¿Cómo paso de la prueba de 14 días a una suscripción?',
    answer: [
      '1. En **Suscripción y cobros** (o desde **Suscribirme** en el aviso de prueba), elegí un plan y escribí el **Email de tu cuenta de Mercado Pago**.',
      '2. Elegí **Seguir con la prueba** (cobra al terminar los 14 días) o **Pagar ahora** (cobra hoy y termina la prueba).',
      '3. Tocá **Suscribirme** y completá la autorización en Mercado Pago.',
    ],
    audiences: ['admin'],
    link: { path: '/suscripcion', label: 'Suscripción y cobros' },
  },
  {
    id: 'change-subscription-plan',
    topic: 'Suscripción',
    question: '¿Cómo cambio de plan?',
    answer: [
      'En **Suscripción y cobros** > **Cambio de plan e historial**, elegí el **Nuevo plan** y tocá **Confirmar cambio de plan**.',
      'Si subís, pagás la diferencia proporcional y el cupo se amplía al aprobarse el pago. Si bajás, rige desde el próximo ciclo, sin reintegro, y elegís qué vigiladores siguen activos.',
    ],
    audiences: ['admin'],
    link: { path: '/suscripcion', label: 'Suscripción y cobros' },
  },
  {
    id: 'failed-charge-and-grace-period',
    topic: 'Suscripción',
    question: '¿Qué hago si falla el cobro mensual?',
    answer: [
      'Tenés 7 días de gracia con el servicio funcionando. En **Suscripción y cobros**, usá **Cambiar medio de pago** o **Reintentar cobro**.',
      'Si vencen los 7 días, la cuenta se suspende; podés reactivarla con **Pagar lo adeudado** en esa misma pantalla.',
    ],
    audiences: ['admin'],
    link: { path: '/suscripcion', label: 'Suscripción y cobros' },
  },
  {
    id: 'cancel-or-revert-subscription',
    topic: 'Suscripción',
    question: '¿Cómo cancelo la suscripción?',
    answer: [
      'En **Suscripción y cobros**, tocá **Cancelar suscripción** y confirmá. El servicio sigue hasta el fin del ciclo pagado, sin nuevos cobros, y después la cuenta se suspende.',
      'Hasta esa fecha podés arrepentirte con **Revertir cancelación**.',
    ],
    audiences: ['admin'],
    link: { path: '/suscripcion', label: 'Suscripción y cobros' },
  },
  {
    id: 'suspended-account-access',
    topic: 'Cuenta suspendida',
    question: '¿Qué puedo seguir usando si la cuenta está suspendida?',
    answer: [
      '**Turnos en curso**, **Avisos** y **Alertas de pánico** de los turnos que empezaron antes de la suspensión. Las alertas de pánico pendientes se pueden atender aunque haya vencido el plazo de esos turnos.',
      'No se pueden crear turnos ni programaciones. Solo el administrador regulariza desde **Suscripción y cobros**; el supervisor tiene que avisarle.',
    ],
    audiences: ['admin', 'supervisor'],
    link: { path: '/supervision', label: 'Turnos en curso' },
  },
  {
    id: 'enable-web-notifications',
    topic: 'Panel y notificaciones',
    question: '¿Cómo activo las notificaciones del panel?',
    answer: [
      'Tocá la campana **Activar notificaciones** en la barra superior (en pantallas chicas, en el menú lateral) y aceptá el permiso. Repetilo en cada dispositivo.',
      'Si lo rechazaste, habilitalo en los ajustes del navegador. En iPhone o iPad (iOS 16.4 o posterior), primero instalá el panel en la pantalla de inicio.',
    ],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'install-web-panel',
    topic: 'Panel y notificaciones',
    question: '¿Puedo instalar el panel como una app?',
    answer: [
      'Sí. En computadora o Android, usá la opción de instalar del navegador. En iPhone o iPad, tocá **Compartir** en Safari y elegí **Agregar a pantalla de inicio**.',
    ],
    audiences: ['admin', 'supervisor'],
  },

  // ── Cliente ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'client-portal-overview',
    topic: 'Portal del cliente',
    question: '¿Qué puedo ver en el portal?',
    answer: [
      'En **Reportes** ves el cumplimiento de las rondas de tus predios activos, los **Incidentes compartidos** por tu empresa de seguridad y las **Emergencias** reales ya resueltas.',
      'No muestra datos internos de la empresa, como nombres de vigiladores o notas internas.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-filter-reports',
    topic: 'Portal del cliente',
    question: '¿Cómo elijo el predio y el período de mis reportes?',
    answer: [
      'En **Predio**, dejá **Todos mis predios** o elegí uno. Completá **Desde** y **Hasta (sin incluir)** y tocá **Consultar**: para ver todo octubre, elegí del 1 de octubre al 1 de noviembre.',
      'Por defecto ves el último mes, y podés consultar hasta 12 meses. Las horas usan la zona horaria de tu empresa de seguridad.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-compliance-calculation',
    topic: 'Portal del cliente',
    question: '¿Cómo se calcula el porcentaje de cumplimiento?',
    answer: [
      'Divide las rondas **Completa** por el total de rondas evaluadas (**Completa**, **Incompleta** y **No realizada**).',
      'Si en el período no hay rondas evaluadas, muestra **Sin datos** en lugar de cero.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-rounds-in-verification',
    topic: 'Portal del cliente',
    question: '¿Qué significa En verificación?',
    answer: [
      'Son rondas que tu empresa de seguridad todavía está revisando. Se informan aparte y no cuentan en el porcentaje hasta que terminan de revisarse.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-day-rounds-detail',
    topic: 'Portal del cliente',
    question: '¿Cómo veo las rondas de un día puntual?',
    answer: [
      'Tocá el día en **Evolución diaria del cumplimiento**, o abrí **Ver datos** debajo del gráfico y tocá **Ver ventanas** en esa fila.',
      'Se abre el listado con predio, horario y estado de cada ronda; usá **Anterior** y **Siguiente** para pasar de página.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-export-pdf',
    topic: 'Portal del cliente',
    question: '¿Cómo descargo mis reportes en PDF?',
    answer: [
      'Elegí el predio y un período de hasta 3 meses, tocá **Consultar** y después **Exportar a PDF**.',
      'Incluye cumplimiento, rondas, incidentes compartidos con su nota y emergencias reales. Las fotos no van en el PDF: se ven en el portal.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-shared-incidents',
    topic: 'Incidentes y emergencias',
    question: '¿Qué incidentes aparecen en Incidentes compartidos?',
    answer: [
      'Solo los de tus predios activos que tu empresa de seguridad decidió mostrarte. Cada tarjeta indica tipo, predio, fecha y hora y la última nota para vos.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-incident-photos',
    topic: 'Incidentes y emergencias',
    question: '¿Cómo veo las fotos de un incidente?',
    answer: [
      'Tocá **Ver fotos** en la tarjeta (indica cuántas hay) y elegí una para ampliarla. Cerrala con **Cerrar foto** o la tecla Escape.',
      'Si no cargan, tocá **Reintentar fotos**.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-emergencies',
    topic: 'Incidentes y emergencias',
    question: '¿Qué alertas aparecen en Emergencias?',
    answer: [
      'Solo las alertas de pánico de tus predios activos que ya se resolvieron como emergencias reales. No aparecen alertas abiertas, falsas alarmas ni pruebas.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-emergency-response-time',
    topic: 'Incidentes y emergencias',
    question: '¿Qué mide el Tiempo de respuesta de la empresa?',
    answer: [
      'Los segundos entre la activación de la alerta y la confirmación de tu empresa de seguridad en Garita.',
      'No mide cuánto tardó alguien en llegar al predio.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-no-data',
    topic: 'Problemas en el portal',
    question: '¿Por qué no veo datos en mis reportes?',
    answer: [
      'Porque no hay información para ese predio y período: los avisos **Sin rondas evaluadas**, **Sin incidentes compartidos** o **Sin emergencias** lo indican. Probá con otro filtro.',
      'Si falló la conexión, tocá **Reintentar**.',
    ],
    audiences: ['client'],
    link: { path: '/reportes', label: 'Reportes' },
  },
  {
    id: 'client-missing-site',
    topic: 'Problemas en el portal',
    question: '¿Por qué no aparece uno de mis predios?',
    answer: [
      'Porque el portal muestra solo predios activos asociados a tu cuenta. Si falta uno, consultá a tu empresa de seguridad.',
    ],
    audiences: ['client'],
  },
  {
    id: 'client-service-unavailable',
    topic: 'Problemas en el portal',
    question: '¿Por qué dice que el servicio no está disponible temporalmente?',
    answer: [
      'Porque la cuenta de tu empresa de seguridad está suspendida y el portal queda pausado hasta que la regularice. Consultá a tu empresa de seguridad.',
    ],
    audiences: ['client'],
  },

  // ── Vigilador ────────────────────────────────────────────────────────────────────────────
  {
    id: 'guard-start-shift',
    topic: 'Turnos',
    question: '¿Cómo inicio mi turno?',
    answer: [
      'Abrí el turno desde **Hoy** o **Turnos** y tocá **Iniciar turno**. Necesitás internet en ese momento: el celular descarga las rondas y los puntos.',
      'Podés iniciarlo desde 30 minutos antes (en predios sin señal, según el margen de tu empresa). Si iniciás tarde, el turno arranca igual y registra la demora.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-cannot-start-shift',
    topic: 'Turnos',
    question: '¿Por qué no puedo iniciar mi turno?',
    answer: [
      'Revisá el aviso en pantalla. Las causas son: todavía es temprano (te indica desde qué hora), ya tenés otro turno en curso, quedaron registros o fotos sin enviar del turno anterior, faltan permisos o no tenés conexión.',
      'Si dice que el turno fue reasignado o ya no está disponible, consultá a tu supervisor.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-view-shifts',
    topic: 'Turnos',
    question: '¿Dónde veo mis próximos turnos?',
    answer: [
      'En **Hoy** ves los turnos del día o tu **Próximo turno**. En **Turnos** ves los **Próximos** y **Anteriores**, con filtros por fecha y predio y el resumen de horas.',
      'Deslizá hacia abajo para actualizar.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-round-windows',
    topic: 'Turnos',
    question: '¿Cómo sé qué puntos me faltan en la ronda?',
    answer: [
      'En **Ronda** ves cada ronda con su ventana activa y los puntos pendientes en orden. El bloque **Cierre de turno** muestra el estado de cada ventana (**A tiempo**, **Tarde**, **No realizada** y otros).',
      'Se actualiza sola cada minuto y después de cada escaneo, aun sin señal.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-close-shift',
    topic: 'Turnos',
    question: '¿Cómo cierro mi turno?',
    answer: [
      'En **Ronda**, bajá hasta **Cierre de turno** y tocá **Cerrar turno**. Si todavía no es la hora de fin, escribí un **Motivo del cierre anticipado**.',
      'Podés cerrarlo sin señal: queda **Cerrado, pendiente de envío** hasta que vuelva la conexión.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-sites-and-route-map',
    topic: 'Turnos',
    question: '¿Dónde veo cómo llegar al predio y el recorrido?',
    answer: [
      'En **Predios**, tocá el predio para ver **Cómo llegar**, las indicaciones de **Acceso** y sus rondas. Tocá una ronda, o **Ver recorrido en el mapa** desde **Ronda**, para ver los puntos numerados en orden.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-missing-shift-data',
    topic: 'Turnos',
    question: '¿Qué hago si dice que faltan los datos del turno en este celular?',
    answer: [
      'Comunicate con tu supervisor. Pasa cuando el turno figura en curso pero sus datos no están en este teléfono (por ejemplo, se inició en otro o se borraron los datos de la app), y desde acá no podés registrar puntos.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-qr',
    topic: 'Escaneo de puntos',
    question: '¿Cómo registro un punto con el código QR?',
    answer: [
      '1. En **Ronda**, tocá **Escanear** junto al punto (o **Escanear código QR**) y apuntá la cámara al sticker.',
      '2. Cuando vibra y suena, el punto quedó registrado: tocá **Escanear otro punto** o **Volver a la ronda**.',
      'Funciona sin señal. Si hay poca luz, tocá **Linterna: OFF** para encenderla.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-nfc',
    topic: 'Escaneo de puntos',
    question: '¿Cómo registro un punto con la etiqueta NFC?',
    answer: [
      'En Android, con **Lectura de etiquetas activa**, acercá la parte trasera del celular a la etiqueta hasta que vibre. En iPhone, tocá **Leer etiqueta** primero.',
      'Si ves **El NFC está apagado**, tocá **Abrir ajustes** para encenderlo. Siempre podés usar el QR del punto.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-too-soon',
    topic: 'Escaneo de puntos',
    question: '¿Por qué dice que el punto ya está registrado o que es muy pronto?',
    answer: [
      'Porque ya lo escaneaste en esta vuelta, o porque entre dos pasadas por el mismo punto tiene que pasar al menos la mitad de la ventana. La app te indica desde qué hora podés volver a escanearlo.',
      'Si el punto está en varias rondas de tu turno, un solo escaneo cuenta para todas.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-scan-invalid',
    topic: 'Escaneo de puntos',
    question: '¿Qué pasa si escaneo un código de otro predio o uno inválido?',
    answer: [
      'No se registra el punto: la app te muestra el motivo y guarda el intento para que lo vea tu supervisor.',
      'Si un registro se rechaza al enviarse, aparece en **Registros observados por el servidor**.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-panic-button',
    topic: 'Botón de pánico',
    question: '¿Cómo activo el botón de pánico?',
    answer: [
      'Durante un turno en curso, mantené presionado dos segundos el botón circular (**Mantené** / **2 segundos**). Un toque corto no activa nada.',
      'Vibra brevemente, sin sonido, y envía tu ubicación. No se puede cancelar: si fue un error, avisá a tu supervisor.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-panic-confirmation',
    topic: 'Botón de pánico',
    question: '¿Cómo sé si mi alerta de pánico llegó?',
    answer: [
      'Solo **Alerta recibida por la central** confirma que llegó, y **Confirmada por el supervisor** confirma que alguien la vio. Los estados del SMS no confirman nada de eso.',
      'Si no ves ninguno de esos dos textos, llamá al 911 o pedí ayuda por otra vía.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-panic-lock-screen',
    topic: 'Botón de pánico',
    question: '¿Puedo activar el pánico con el celular bloqueado?',
    answer: [
      'Sí, en Android con notificaciones activadas: encendé la pantalla, tocá **Pánico** en el aviso **Turno en curso** y después **Confirmar pánico** dentro de los 5 segundos.',
      'En iPhone no: desbloqueá el celular y usá el botón dentro de la app.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-panic-sms-fallback',
    topic: 'Botón de pánico',
    question: '¿Funciona el pánico si no tengo internet?',
    answer: [
      'Sí, por SMS. Sin internet, Garita prepara un SMS con tu turno, la hora y la ubicación; en Android con el permiso **SMS de emergencia** sale solo, y si no, se abre Mensajes para que toques enviar.',
      'Necesitás señal de celular y línea habilitada. Cuando vuelve internet, la alerta se reintenta sola.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-work-offline',
    topic: 'Sin señal y envío',
    question: '¿Puedo trabajar si me quedo sin señal?',
    answer: [
      'Sí. Una vez iniciado el turno, podés escanear puntos, reportar incidentes con fotos y cerrar el turno sin señal: todo queda guardado en el celular.',
      'Solo necesitás conexión para iniciar el turno.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-check-pending-uploads',
    topic: 'Sin señal y envío',
    question: '¿Cómo sé si mis registros y fotos ya se enviaron?',
    answer: [
      'Abrí **Envíos** en el menú lateral (o tocá el aviso **por enviar** de arriba). Cuando no falta nada, dice **Todo enviado**.',
      'Se envían solos al volver la señal; para forzarlo, tocá **Enviar ahora**. No desinstales la app ni borres sus datos hasta ver **Todo enviado**.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-report-incident',
    topic: 'Incidentes',
    question: '¿Cómo reporto un incidente?',
    answer: [
      '1. En **Ronda**, tocá **Reportar incidente** y elegí el **Tipo de incidente**.',
      '2. Escribí la **Descripción** (obligatoria si elegís **Otro**) y sumá hasta 5 fotos con **Tomar foto** o **Elegir de galería**.',
      '3. Tocá **Guardar incidente**. Si no hay señal, se envía solo cuando vuelve.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-permissions',
    topic: 'Permisos y cuenta',
    question: '¿Qué permisos necesita la app y para qué?',
    answer: [
      '**Ubicación precisa** y **Cámara**. Si falta alguno, en **Permisos para trabajar** tocá **Permitir** hasta ver **Permitida** y después **Siguiente**.',
      'La ubicación se toma solo al iniciar o cerrar el turno, registrar puntos, reportar incidentes o activar pánico: no te sigue todo el tiempo. En Android también pide notificaciones y **SMS de emergencia**.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-notifications',
    topic: 'Permisos y cuenta',
    question: '¿Por qué no me llegan avisos de cambios en mis turnos?',
    answer: [
      'En Android, revisá que estén activadas en los ajustes del celular (**Garita > Notificaciones**) y que tengas conexión. Avisan asignaciones, cambios de horario, reasignaciones y cancelaciones.',
      'En iPhone todavía no hay avisos: deslizá hacia abajo en **Hoy** o **Turnos** para ver novedades.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-company-suspended',
    topic: 'Permisos y cuenta',
    question: '¿Puedo trabajar si la cuenta de mi empresa está suspendida?',
    answer: [
      'No podés iniciar turnos nuevos. Si ya tenías uno en curso, podés terminarlo, cerrarlo, enviar los registros y usar el botón de pánico.',
    ],
    audiences: ['guard'],
  },
  {
    id: 'guard-logout',
    topic: 'Permisos y cuenta',
    question: '¿Cómo cierro sesión en la app?',
    answer: [
      'Abrí el menú lateral (arriba a la izquierda) y tocá **Cerrar sesión**, con conexión a internet.',
      'Si tenés registros sin enviar, la app te avisa: no se borran, pero se envían recién cuando vuelvas a ingresar.',
    ],
    audiences: ['guard'],
  },
];

/** Sin sesión, solo lo público; con sesión, primero lo de su rol y al final lo público. */
export function faqForRole(
  role: UserRole | null,
  entries: readonly FaqEntry[] = faqEntries,
): FaqEntry[] {
  const own = role === null ? [] : entries.filter((entry) => entry.audiences.includes(role));
  // Una entrada pública y del rol a la vez aparece una sola vez (las claves deben ser únicas).
  return [...own, ...entries.filter((e) => e.audiences.includes('public') && !own.includes(e))];
}

/** En la app, administrador y supervisor solo ven lo que aplica a la app (etiquetas NFC). */
export function faqForApp(
  role: UserRole | null,
  entries: readonly FaqEntry[] = faqEntries,
): FaqEntry[] {
  if (role !== 'admin' && role !== 'supervisor') return faqForRole(role, entries);
  return faqForRole(role, entries).filter(
    (entry) => entry.audiences.includes('public') || entry.inApp,
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
    const haystack = normalize([entry.topic, entry.question, ...entry.answer].join(' ')).replaceAll(
      '**',
      '',
    );
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
