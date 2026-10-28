# Ventanas de ronda

La configuración guarda la hora local de inicio y fin, la frecuencia en minutos y la zona IANA de la empresa (`Company.timezone`). La zona predeterminada es `America/Argentina/Buenos_Aires`. `computeRoundWindows` recibe explícitamente la fecha local de inicio (`YYYY-MM-DD`) y produce instantes UTC como cadenas ISO 8601; cada resultado incluye además una etiqueta local `HH:mm–HH:mm`.

Una franja final anterior a la inicial cruza medianoche y se trata como un bloque continuo. La última ventana se recorta al fin de la franja. Si ambas horas coinciden, el bloque dura 24 horas y comienza en esa hora. `previewWindows` devuelve solo las etiquetas y no requiere fecha ni zona horaria.

Las conversiones usan `Intl.DateTimeFormat` con una zona IANA explícita, sin depender del reloj local del dispositivo ni agregar una biblioteca de fechas. El runtime debe ofrecer `Intl` con `formatToParts` y soporte de zonas IANA. En el flujo de turnos, `windowsForShift` clasifica ventanas completas y ventanas que terminan dentro del turno, incluyendo las que empezaron antes del turno.

Cada edición crea un `RoundVersion` nuevo con sus propios puntos ordenados. La versión anterior se conserva para que HU-10 pueda fijarla al turno ya iniciado; los turnos futuros consultarán la versión vigente. Los puntos se pueden compartir entre rondas.

HU-11 agregará al módulo la imputación de registros a ventanas, aplicando la gracia configurada y el tiempo mínimo entre registros del mismo punto.
