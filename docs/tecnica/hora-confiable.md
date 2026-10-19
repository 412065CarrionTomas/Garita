# Hora confiable (HU-14)

Cada evento conserva la hora del celular y una lectura nativa del tiempo transcurrido desde el arranque. La referencia UTC llega del servidor; el cálculo compartido usa `serverTime + elapsedMsEvento - elapsedMsReferencia`. Cambiar la hora o zona horaria del teléfono no cambia ese intervalo. Los incidentes de HU-19 pueden reutilizar `deviceClockSchema` sin duplicar el contrato.

## Contratos y compatibilidad

`GET /api/v1/hora` devuelve exclusivamente `{ serverTime }`, con `Cache-Control: no-store`. Es público porque no revela identidad, ubicación, empresa ni turno, y debe funcionar cuando Firebase no puede renovar el token. No existe una operación para cargar referencias en el servidor: GET ignora parámetros proporcionados por el cliente y POST devuelve 404. Swagger describe la respuesta.

El inicio de turno y cada lote devuelven `serverTime` actual, incluso en un replay del inicio. En las respuestas compartidas ese campo es opcional para admitir servidores anteriores. `clock` también es opcional en registros, inicio y cierre: la API sigue aceptando clientes antiguos y usa su `occurredAtDevice` cuando falta `trustedAt`.

| Bloque                     | Campos                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `deviceClockSchema`        | `deviceTime`, `elapsedMs` entero no negativo, `bootId`, `trustedAt` nullable, `timeStatus`, `referenceOffsetMs` nullable |
| `timeReferenceSchema`      | `serverTime`, `elapsedMs`, `bootId`, `offsetMs`                                                                          |
| `serverTimeResponseSchema` | `serverTime`                                                                                                             |

El desfase usa **hora del celular menos hora UTC confiable**, en milisegundos. `referenceOffsetMs` conserva el desfase de la referencia vigente al producir el evento, aunque pertenezca al arranque anterior. Un reloj ya adelantado tres minutos al iniciar no se marca: la regla compara cambios de desfase, con tolerancia estricta de más de 120 000 ms.

## Secuencias

```text
Referencia:
App -> API: iniciar turno / sincronizar lote / GET hora
API -> App: serverTime actual
App -> Nativo: getMonotonicClock()
App -> SQLite sync_state: referencia por bootId y última referencia

Evento con referencia del mismo arranque:
App -> Nativo: elapsedMs + bootId
App -> SQLite: evento con trustedAt calculado, deviceTime y estado verified
App -> API: evento persistido
API -> PostgreSQL: hora original + confiable; imputación con hora confiable
API -> RecordFlag: evaluar desfase y futuro, sin descartar el registro

Reinicio sin señal:
App -> Nativo: nuevo bootId, elapsedMs desde este arranque
App -> SQLite: evento con trustedAt null y estado pending
Pantalla: usa deviceTime como hora provisoria de la ventana

Recálculo antes del envío:
Cola -> SQLite: buscar referencia persistida del arranque del evento
Cola -> API: GET hora cuando todavía no existe referencia de ese arranque
App -> Nativo: lectura del arranque actual
App -> SQLite: nueva referencia
Cola -> SQLite: payload recalculado hacia atrás; estado recalculated
Cola -> API: enviar el payload resuelto

Dos reinicios sin referencia intermedia:
Cola: bootId del evento intermedio != bootId de nueva referencia
Cola -> SQLite: estado unverifiable, trustedAt null
API: conserva evento, agrega time_unverifiable y usa hora provisoria
Eventos del último arranque: reciben trustedAt y estado recalculated
```

Las referencias por arranque permiten recuperar eventos pendientes aunque una referencia ya se haya guardado antes de otro reinicio. Nunca se recalcula un payload ya resuelto: el hash idempotente permanece estable entre reintentos. Si obtener la hora falla, se conservan los eventos pendientes y los demás eventos del lote pueden continuar; se programa el reintento habitual de la cola.

SQLite entrega la cola en orden de inserción (`rowid`), incluso cuando el vigilador atrasó la hora entre un registro y el cierre. El límite de lectura sigue siendo 100 eventos. El watermark `syncedUntil` usa `trustedAt` cuando existe, incluyendo los eventos recibidos y rechazados; ante fallo de transporte no avanza. La API aplica la misma elección al registrar el lote.

## Persistencia e imputación

La migración `hora_confiable` agrega `trustedAt`, `elapsedMs`, `bootId`, `timeStatus` y `deviceOffsetMs` a `CheckpointRecord` y `ShiftEvent`. Las columnas son nullable para conservar datos existentes. Los milisegundos se almacenan como double precision y se validan como enteros seguros en Zod: un entero PostgreSQL de 32 bits desbordaría después de unos 25 días de uptime.

La imputación de ventanas, los límites de cumplimiento después de un cierre administrativo, el cierre real del turno y el cálculo de velocidad entre puntos usan `trustedAt ?? occurredAtDevice`. La evaluación de velocidad compara el último candidato confiable y el último candidato legacy por su hora efectiva, para admitir datos mixtos.

| Marca               | Gravedad | Regla                                                                                                              |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `time_altered`      | grave    | Cambio de desfase mayor a dos minutos respecto de la referencia del evento, o `trustedAt` posterior a la recepción |
| `time_unverifiable` | leve     | Evento de un arranque terminado sin referencia, con estado `unverifiable`                                          |

El registro se guarda aunque reciba una marca. Los registros `recalculated` no se marcan por el mero reinicio; sí por un cambio de desfase o una hora futura. Los clientes sin `clock` mantienen el comportamiento anterior.

Las marcas de puntos siguen el evaluador y `RecordFlag` de [marcas-de-registros.md](marcas-de-registros.md). Para los eventos de turno, se guardan en `ShiftEvent.response.timeFlags`, sin crear una FK hacia puntos. `shortcut: las marcas de turno viven en el JSON del evento, exponerlas en el panel corresponde a HU-16/HU-39`. La respuesta al vigilador no expone esas marcas. La validación temporal legacy del cierre se conserva cuando no hay `clock`; con reloj, una hora futura queda guardada y marcada.

Para el supervisor, una marca indica una sospecha que requiere revisión; una corrección automática de hora de la red puede producir un cambio de desfase sin intervención humana. `unverifiable` significa que no se puede reconstruir la hora, no que el evento sea falso.

## APIs nativas y fuentes oficiales

- Android usa [`SystemClock.elapsedRealtime()`](<https://developer.android.com/reference/android/os/SystemClock#elapsedRealtime()>), milisegundos desde el arranque incluyendo suspensión profunda. [`Settings.Global.BOOT_COUNT`](https://developer.android.com/reference/android/provider/Settings.Global#BOOT_COUNT), disponible desde API 24, identifica el arranque. Si falta o su lectura falla, un UUID de proceso evita reutilizar referencias potencialmente ajenas: reiniciar el proceso puede producir eventos no verificables de forma conservadora.
- iOS usa [`mach_continuous_time`](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time), que incluye suspensión, convertido con `mach_timebase_info`. No se usa `mach_absolute_time`, que se detiene durante el sueño. Se convierte a `Double` antes de multiplicar y se redondea hacia abajo a milisegundos.
- iOS intenta `sysctlbyname("kern.bootsessionuuid")`: el [código oficial de XNU, `kern_sysctl.c`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c) lo declara de solo lectura (`CTLFLAG_RD`). **Esto no demuestra que cada versión de iOS permita su lectura desde una app sandboxed**: queda verificación física explícita en iPhone. Si falla, se usa `kern.boottime` como `timeval`, conforme al [manual oficial de sysctl](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/sysctl.3.html); si también falla, UUID del proceso.
- La decisión inicial de usar solamente boottime se corrigió con aprobación del coordinador: [XNU `clock_set_calendar_microtime`](https://github.com/apple/darwin-xnu/blob/main/osfmk/kern/clock.c) ajusta la hora de arranque cuando cambia la hora del sistema. **Con el fallback boottime, un cambio de hora puede parecer otro reinicio y dejar eventos anteriores como `unverifiable`**. Se prefiere perder verificabilidad antes que atribuir una hora falsa.

El módulo pasa de 1.0.0 a 1.1.0 y requiere reconstruir el development client. Jest usa un mock del módulo nativo; no demuestra compilación Kotlin/Swift ni deriva física. El prebuild de Expo valida configuración y generación, no compila código nativo.

## Límites y prueba en dispositivo

La exactitud física de menos de cinco segundos tras doce horas depende del oscilador, suspensión y latencia de red al tomar la referencia. La referencia se toma al recibir la respuesta; una respuesta muy demorada agrega ese error. Los tests puros demuestran exactitud aritmética, no calibración real. TLS protege el transporte; un teléfono comprometido capaz de modificar la app o SQLite puede falsificar los metadatos: este mecanismo detecta cambios del reloj configurables por el usuario, no constituye atestación criptográfica del dispositivo.

Ejecutar en **Android y iPhone**, anotando modelo, versión del SO, error medido y `bootId` antes/después (sin registrar ubicaciones ni credenciales):

- [ ] CA1/BDD1: iniciar con hora normal, adelantar tres horas, registrar: hora real conservada y marca grave.
- [ ] CA2/BDD2: doce horas sin señal con pantalla apagada: error absoluto menor a cinco segundos y sin marca.
- [ ] CA3/BDD3: reiniciar sin señal, registrar, recuperar red: recálculo menor a cinco segundos y sin marca por reinicio.
- [ ] CA5/BDD4: reiniciar sin señal y atrasar una hora: hora reconstruida y marca grave.
- [ ] CA6/BDD5: dos reinicios sin referencia intermedia: eventos intermedios no verificables y últimos recalculados.
- [ ] CA7: adelantar tres minutos antes del inicio y mantenerlos: sin marca de alteración.
- [ ] iPhone: comprobar lectura de `ios-session:` desde un development client sandboxed, estabilidad al cambiar hora y al reabrir la app, y cambio tras reiniciar; si aparece `ios:` o `process:`, registrar que se activó el fallback.
- [ ] Android: comprobar `android:` y estabilidad al reabrir la app; si aparece `process:`, verificar el comportamiento conservador.
