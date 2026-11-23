import { z } from 'zod';

import { GRACE_DAYS, TRIAL_DAYS } from './account';

/**
 * Términos y Condiciones y Política de Privacidad. Una sola versión cubre ambos documentos:
 * cambiar cualquier texto exige subir `LEGAL_VERSION`, y cada usuario vuelve a aceptarla al ingresar.
 */
export const LEGAL_VERSION = '2026-11-22';

/** Titular del servicio. Único lugar donde viven sus datos. */
export const LEGAL_OWNER = {
  name: 'Tomás Ezequiel Carrión',
  taxId: '20-40000000-07',
  address: 'Córdoba, Argentina',
  email: 'soporte.app.garita@gmail.com',
} as const;

/** `2026-11-22` → `22/11/2026`. */
export function formatLegalDate(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

export interface LegalSection {
  heading: string;
  paragraphs: readonly string[];
}

export interface LegalDocument {
  title: string;
  updatedAt: string;
  intro: string;
  sections: readonly LegalSection[];
}

const owner = `${LEGAL_OWNER.name} (CUIT/CUIL ${LEGAL_OWNER.taxId}), con domicilio en ${LEGAL_OWNER.address}`;

export const termsOfService: LegalDocument = {
  title: 'Términos y Condiciones de uso',
  updatedAt: LEGAL_VERSION,
  intro: `Garita es un servicio provisto por ${owner} (en adelante, "Garita", "nosotros"). Estos Términos y Condiciones (los "Términos") y la Política de Privacidad regulan el uso del panel web y de la aplicación móvil de Garita (el "Servicio"). Al activar tu cuenta, marcar la casilla de aceptación o usar el Servicio declarás haberlos leído, entendido y aceptado. Si no estás de acuerdo, no uses el Servicio.`,
  sections: [
    {
      heading: '1. Definiciones',
      paragraphs: [
        'Empresa: la empresa de seguridad que contrata el Servicio y administra su cuenta. Es la única contraparte comercial de Garita.',
        'Usuario: toda persona que accede al Servicio con credenciales propias, con alguno de estos roles: Administrador, Supervisor, Cliente o Vigilador.',
        'Cliente: el tercero contratante de la Empresa que accede a la información de sus propios predios mediante el portal.',
        'Datos de la Empresa: toda la información que la Empresa o sus Usuarios cargan o generan en el Servicio, incluidos registros de rondas, ubicaciones, incidentes, fotografías y alertas.',
      ],
    },
    {
      heading: '2. Descripción del Servicio',
      paragraphs: [
        'Garita es una herramienta de software para planificar, registrar y controlar rondas de vigilancia: puntos de control por código QR o etiqueta NFC, turnos, supervisión en vivo, reporte de incidentes con fotografías, botón de pánico, notificaciones y reportes de cumplimiento.',
        'Garita es una herramienta de apoyo a la gestión. No presta servicios de seguridad, vigilancia, monitoreo de alarmas ni respuesta a emergencias, y no reemplaza la organización, los procedimientos ni el personal de la Empresa.',
        'Podemos agregar, modificar o retirar funciones. Si un cambio reduce de forma sustancial las funciones contratadas, lo avisaremos con al menos 30 días de anticipación.',
      ],
    },
    {
      heading: '3. Botón de pánico y situaciones de emergencia',
      paragraphs: [
        'EL BOTÓN DE PÁNICO NO REEMPLAZA A LOS SERVICIOS DE EMERGENCIA (911, POLICÍA, BOMBEROS O SERVICIOS MÉDICOS) NI A LOS PROCEDIMIENTOS DE EMERGENCIA DE LA EMPRESA. Ante un peligro, el Usuario debe comunicarse con los servicios de emergencia por todos los medios a su alcance.',
        'La alerta depende de factores fuera de nuestro control: batería y estado del teléfono, permisos otorgados, señal de datos y de telefonía, operadoras, proveedores de notificaciones y la atención efectiva por parte de la Empresa. Garita no garantiza que una alerta, un SMS o una notificación lleguen, ni que lleguen en un tiempo determinado.',
        'La Empresa es la única responsable de designar a quién recibe y atiende las alertas, del número configurado para el SMS de respaldo y de capacitar a su personal en el uso del botón.',
      ],
    },
    {
      heading: '4. Cuentas, acceso y credenciales',
      paragraphs: [
        'El acceso es únicamente por invitación de un Administrador de la Empresa. Cada cuenta es personal e intransferible.',
        'El Usuario es responsable de mantener la confidencialidad de su contraseña y de todo lo que se haga con su cuenta. Debe avisar de inmediato a su Empresa y a Garita ante cualquier uso no autorizado.',
        'Garita nunca te va a pedir tu contraseña por correo, teléfono o mensaje.',
        'La Empresa es responsable de dar de alta, desactivar y mantener actualizados a sus Usuarios, y de desactivar sin demora a quien deje de trabajar con ella.',
      ],
    },
    {
      heading: '5. Uso aceptable',
      paragraphs: [
        'Está prohibido: (a) compartir credenciales o usar la cuenta de otra persona; (b) alterar el reloj o la ubicación del dispositivo, copiar, fotografiar o reproducir códigos QR o etiquetas NFC, o registrar puntos de control sin estar físicamente en ellos; (c) activar alertas de pánico falsas de forma intencional; (d) cargar contenido ilícito, ofensivo o que viole derechos de terceros, incluidas fotografías tomadas en infracción de la ley; (e) intentar acceder a datos de otras empresas, vulnerar la seguridad, hacer ingeniería inversa o sobrecargar el Servicio; (f) usar el Servicio para fines distintos al control de rondas de la Empresa.',
        'Los registros manipulados no tienen valor como constancia de cumplimiento. Ante un uso prohibido podemos suspender el acceso del Usuario o de la Empresa, sin perjuicio de las acciones legales que correspondan.',
      ],
    },
    {
      heading: '6. Obligaciones de la Empresa respecto de su personal',
      paragraphs: [
        'El Servicio registra la ubicación y la hora del Vigilador durante su turno. La Empresa, como empleadora y responsable de los datos de su personal, declara y garantiza que: (a) informa de manera previa y por escrito a sus empleados que su actividad laboral será controlada mediante el Servicio, con qué alcance y con qué finalidad; (b) limita el control al horario de trabajo y a fines legítimos de organización y control; (c) cumple la Ley de Contrato de Trabajo N.º 20.744, los convenios colectivos aplicables, la Ley N.º 25.326 de Protección de los Datos Personales y la normativa que regula la seguridad privada.',
        'La Empresa mantendrá indemne a Garita frente a reclamos de sus empleados, Clientes o terceros derivados del incumplimiento de estas obligaciones o del uso que la Empresa haga de los Datos de la Empresa.',
      ],
    },
    {
      heading: '7. Período de prueba, planes y pagos',
      paragraphs: [
        `Cada Empresa dispone de un único período de prueba gratuito de ${TRIAL_DAYS} días corridos, con el cupo de vigiladores del plan básico. No se puede iniciar otra prueba para la misma Empresa.`,
        'Al finalizar la prueba, el uso continuo requiere una suscripción mensual. El precio y el cupo de vigiladores de cada plan se muestran en el panel antes de contratar. Los precios se expresan en pesos argentinos e incluyen los impuestos que correspondan, salvo indicación en contrario.',
        'Los pagos se procesan a través de Mercado Pago, que se rige por sus propios términos. Garita no recibe ni almacena los datos de tarjetas ni de medios de pago.',
        `Si un cobro es rechazado, la cuenta entra en un período de gracia de ${GRACE_DAYS} días para regularizar el pago. Vencido ese plazo sin pago, la cuenta se suspende.`,
        'Podemos modificar los precios avisando con al menos 30 días de anticipación por correo o en el panel. El nuevo precio se aplica desde el siguiente período de facturación posterior al aviso. Si no estás de acuerdo, podés cancelar antes de que se aplique.',
        'Salvo que la ley disponga lo contrario, los importes abonados por períodos ya iniciados no son reembolsables.',
      ],
    },
    {
      heading: '8. Cancelación y suspensión',
      paragraphs: [
        'La Empresa puede cancelar la suscripción en cualquier momento desde el panel. La cancelación impide el próximo cobro; no genera cargos adicionales.',
        'Una cuenta suspendida (por fin de la prueba, por falta de pago o por cancelación) conserva sus datos, pero pierde el acceso a la mayoría de las funciones. Se mantiene el acceso indispensable para cerrar los turnos en curso y atender las alertas de pánico abiertas.',
        'Podemos suspender o dar de baja una cuenta de forma inmediata ante incumplimientos graves de estos Términos, uso fraudulento o requerimiento de autoridad competente. Fuera de esos casos, podemos dar por terminado el Servicio con un preaviso de al menos 60 días.',
      ],
    },
    {
      heading: '9. Datos de la Empresa',
      paragraphs: [
        'Los Datos de la Empresa le pertenecen a la Empresa. Garita los trata solo para prestar el Servicio, según la Política de Privacidad, y nunca los vende.',
        'Cada Empresa trabaja de forma aislada: sus datos no son visibles para otras empresas.',
        'Durante la vigencia del Servicio, la Empresa puede exportar sus reportes desde el panel. Tras la cancelación, la Empresa puede pedir la exportación o la eliminación de sus datos escribiendo a nuestro correo de contacto. Pasados 180 días desde la cancelación o suspensión, podremos eliminar los Datos de la Empresa, con aviso previo por correo, salvo los que debamos conservar por obligación legal.',
        'La Empresa es responsable de la exactitud, la legalidad y el contenido de los datos que carga, y de contar con las autorizaciones necesarias para hacerlo.',
      ],
    },
    {
      heading: '10. Valor de los registros y notificaciones',
      paragraphs: [
        'Los registros del Servicio combinan la hora del dispositivo y la del servidor, y la ubicación informada por el teléfono. Pueden verse afectados por fallas de GPS, de señal o de los dispositivos, situaciones que el Servicio indica cuando las detecta. Los registros son un elemento de información para la Empresa; la Empresa es quien evalúa el cumplimiento de su personal.',
        'Las comunicaciones que Garita envíe al correo registrado o por medio del panel se consideran notificaciones válidas.',
      ],
    },
    {
      heading: '11. Disponibilidad del Servicio',
      paragraphs: [
        'Hacemos esfuerzos razonables para que el Servicio esté disponible, pero se presta "tal como está" y "según disponibilidad". Puede interrumpirse por mantenimiento, fallas de proveedores de infraestructura (alojamiento, bases de datos, autenticación, notificaciones, mapas, pagos), fallas de conectividad o causas de fuerza mayor.',
        'La aplicación móvil guarda los registros en el teléfono cuando no hay señal y los envía al recuperarla. Si el teléfono se pierde, se daña, se reinstala la aplicación o se borran sus datos antes de sincronizar, esos registros pueden perderse.',
      ],
    },
    {
      heading: '12. Limitación de responsabilidad',
      paragraphs: [
        'En la máxima medida permitida por la ley, Garita no será responsable por: (a) robos, daños, lesiones, siniestros u otros hechos ocurridos en los predios vigilados; (b) la falta de atención o la demora en atender alertas o incidentes; (c) decisiones laborales, comerciales o disciplinarias que la Empresa tome con base en el Servicio; (d) lucro cesante, pérdida de clientes, de contratos o de datos, ni daños indirectos o consecuenciales; (e) fallas de dispositivos, redes, operadoras o servicios de terceros.',
        'La responsabilidad total de Garita por cualquier reclamo vinculado con el Servicio no excederá el monto efectivamente abonado por la Empresa en los 12 meses anteriores al hecho que lo origina.',
        'Nada en estos Términos excluye la responsabilidad que no puede limitarse por ley, en particular la que corresponda por dolo o culpa grave.',
      ],
    },
    {
      heading: '13. Propiedad intelectual',
      paragraphs: [
        'El software, la marca, el diseño y los contenidos de Garita están protegidos por la Ley N.º 11.723 de Propiedad Intelectual y demás normas aplicables. La suscripción otorga a la Empresa una licencia de uso limitada, no exclusiva, intransferible y revocable mientras esté vigente. No se transfiere ningún derecho de propiedad.',
        'Si nos enviás sugerencias o comentarios, podemos usarlos para mejorar el Servicio sin obligación de compensación.',
      ],
    },
    {
      heading: '14. Modificaciones de estos Términos',
      paragraphs: [
        'Podemos modificar estos Términos. Publicaremos la nueva versión con su fecha y, cuando el cambio sea relevante, te pediremos que la aceptes al ingresar. Si no la aceptás, no podrás seguir usando el Servicio; la Empresa podrá cancelar su suscripción sin cargo adicional.',
      ],
    },
    {
      heading: '15. Consultas y reclamos',
      paragraphs: [
        `Podés escribirnos a ${LEGAL_OWNER.email} por cualquier consulta, sugerencia o reclamo. Responderemos dentro de los 10 días hábiles.`,
        'Si contrataste el Servicio como consumidor en los términos de la Ley N.º 24.240, podés revocar la aceptación dentro de los 10 días corridos desde la contratación, sin costo, escribiendo al mismo correo. También podés presentar reclamos ante la autoridad de defensa del consumidor que corresponda.',
      ],
    },
    {
      heading: '16. Ley aplicable y jurisdicción',
      paragraphs: [
        'Estos Términos se rigen por las leyes de la República Argentina. Para cualquier controversia, las partes se someten a los tribunales ordinarios de la ciudad de Córdoba, con renuncia a cualquier otro fuero, salvo que la ley aplicable a consumidores disponga otra jurisdicción.',
        'Si alguna cláusula fuera declarada inválida, las demás seguirán vigentes.',
      ],
    },
  ],
};

export const privacyPolicy: LegalDocument = {
  title: 'Política de Privacidad',
  updatedAt: LEGAL_VERSION,
  intro: `Esta política explica qué datos personales trata Garita, con qué finalidad y cuáles son tus derechos, conforme a la Ley N.º 25.326 de Protección de los Datos Personales. Garita es provista por ${owner}.`,
  sections: [
    {
      heading: '1. Roles de cada parte',
      paragraphs: [
        'La Empresa de seguridad que contrata Garita es la responsable de los datos de sus empleados, sus Clientes y sus predios: decide qué datos se cargan y para qué se usan.',
        'Garita actúa como encargada del tratamiento por cuenta de la Empresa, y trata esos datos únicamente para prestar el Servicio y siguiendo sus instrucciones. Garita es responsable directa solo de los datos de facturación y de contacto con la Empresa.',
        'Si sos Vigilador, Supervisor o Cliente, la Empresa es tu primer interlocutor para cualquier consulta sobre tus datos; también podés escribirnos y la derivaremos.',
      ],
    },
    {
      heading: '2. Datos que tratamos',
      paragraphs: [
        'Datos de identificación y contacto: nombre, apellido, correo, teléfono, número de legajo y cargo.',
        'Ubicación precisa del teléfono (GPS) del Vigilador: solo al iniciar y cerrar un turno, al registrar un punto de control y al activar una alerta de pánico. La aplicación no rastrea la ubicación de forma continua ni fuera del turno.',
        'Imágenes: la cámara se usa para leer códigos QR y para las fotografías que el Usuario adjunta a un incidente.',
        'Datos de actividad: turnos, rondas, registros de puntos de control, incidentes, alertas, hora del dispositivo y del servidor, e identificadores técnicos del dispositivo para notificaciones.',
        'SMS de emergencia: si el Vigilador lo autoriza, la aplicación envía un SMS al número que configuró la Empresa, con un código de turno, la hora y la última ubicación. Garita no lee mensajes ni llamadas.',
        'Datos técnicos de acceso: dirección IP, fecha de ingreso y versión aceptada de estos documentos.',
        'Garita no trata datos sensibles en los términos del artículo 2 de la Ley N.º 25.326. Las fotografías de incidentes no deben usarse para registrarlos.',
      ],
    },
    {
      heading: '3. Finalidades',
      paragraphs: [
        'Usamos los datos para: prestar el Servicio (control de rondas, supervisión, alertas e informes); autenticar Usuarios y proteger las cuentas; detectar registros manipulados; enviar notificaciones y correos del Servicio; cobrar la suscripción; cumplir obligaciones legales; y atender consultas.',
        'No vendemos datos personales, no los usamos para publicidad ni hacemos perfiles comerciales.',
      ],
    },
    {
      heading: '4. Con quién se comparten',
      paragraphs: [
        'Dentro de la Empresa, cada rol ve solo lo que le corresponde. El Cliente ve el cumplimiento y los incidentes de sus predios que la Empresa marcó como visibles.',
        'Proveedores que nos ayudan a prestar el Servicio, que tratan los datos por nuestra cuenta y con obligaciones de confidencialidad: alojamiento de la aplicación y la base de datos (Render, Vercel, Neon), autenticación y notificaciones (Google Firebase), almacenamiento de fotografías (Cloudinary), envío de correos, mapas (OpenFreeMap y Photon, a los que solo se envían coordenadas o direcciones) y pagos (Mercado Pago).',
        'Autoridades, cuando lo exija una orden judicial o una norma legal.',
      ],
    },
    {
      heading: '5. Transferencia internacional',
      paragraphs: [
        'Algunos proveedores alojan los datos en servidores fuera de la Argentina, principalmente en los Estados Unidos. Las transferencias se realizan con proveedores que ofrecen niveles adecuados de seguridad y con resguardos contractuales, conforme al artículo 12 de la Ley N.º 25.326 y la normativa de la Agencia de Acceso a la Información Pública. Al aceptar esta política prestás tu consentimiento a esas transferencias.',
      ],
    },
    {
      heading: '6. Conservación',
      paragraphs: [
        'Conservamos los datos mientras la cuenta de la Empresa esté vigente. Tras su cancelación o suspensión se aplican los plazos de los Términos y Condiciones: la Empresa puede pedir su exportación o eliminación, y pasados 180 días podemos eliminarlos con aviso previo.',
        'Conservamos por más tiempo solo lo que exija la ley, por ejemplo la información de facturación.',
      ],
    },
    {
      heading: '7. Seguridad',
      paragraphs: [
        'Aplicamos medidas técnicas y organizativas razonables: conexiones cifradas, aislamiento de datos entre empresas, control de acceso por rol, contraseñas gestionadas por el proveedor de autenticación y credenciales de servicio fuera del código. Ningún sistema es infalible; ante un incidente de seguridad que afecte tus datos, lo informaremos a la Empresa sin demora indebida.',
      ],
    },
    {
      heading: '8. Tus derechos',
      paragraphs: [
        'Podés solicitar el acceso, la rectificación, la actualización o la supresión de tus datos, en forma gratuita, escribiendo a tu Empresa o a ' +
          LEGAL_OWNER.email +
          '. Responderemos el pedido de acceso dentro de los 10 días corridos y los de rectificación o supresión dentro de los 5 días hábiles, según la Ley N.º 25.326. La supresión puede no proceder cuando la Empresa deba conservar los datos por obligación legal o contractual.',
        'LA AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N.º 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.',
        'Los permisos de ubicación, cámara, notificaciones y SMS se pueden revocar desde los ajustes del teléfono; sin ellos, algunas funciones del Vigilador no estarán disponibles.',
      ],
    },
    {
      heading: '9. Menores de edad',
      paragraphs: [
        'El Servicio está destinado a personas mayores de 18 años en el marco de una relación laboral o comercial. No recolectamos datos de menores de forma intencional.',
      ],
    },
    {
      heading: '10. Cambios en esta política',
      paragraphs: [
        'Si modificamos esta política, publicaremos la nueva versión con su fecha y, cuando el cambio sea relevante, te pediremos que la aceptes al ingresar.',
      ],
    },
  ],
};

/** Aceptación explícita de la versión vigente: el servidor rechaza cualquier otra. */
export const legalAcceptanceRequestSchema = z.object({ version: z.literal(LEGAL_VERSION) });
export type LegalAcceptanceRequest = z.infer<typeof legalAcceptanceRequestSchema>;
