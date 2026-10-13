# Asociar etiquetas NFC a puntos de control

La asociación se hace con conexión a internet desde el modo de configuración. La app guarda el identificador de fábrica de la etiqueta; no escribe datos en ella. Usá etiquetas NFC compatibles con el teléfono. Para fijarlas sobre metal, elegí etiquetas anti-metal.

## Instalar el build de desarrollo

El modo NFC requiere instalar un development build de Garita, porque Expo Go no incluye el módulo nativo. El administrador del proyecto puede generar un build Android con:

```bash
pnpm dlx eas-cli@latest build --profile development --platform android
```

Instalá el APK/enlace entregado por EAS y abrí Garita. Iniciá sesión como administrador o supervisor. El administrador puede configurar todos los predios activos de su empresa; el supervisor ve los predios que tiene asignados.

## Asociar o reemplazar en Android

1. Abrí **Modo de configuración** y elegí el predio.
2. Buscá el punto y tocá **Asociar etiqueta**. Para reemplazar una dañada, tocá **Reemplazar etiqueta**.
3. Con la pantalla de asociación abierta, acercá la parte trasera del teléfono a la etiqueta hasta que la app confirme con vibración, sonido y el mensaje **Etiqueta asociada a {punto}**.
4. Si la etiqueta está en otro punto de la empresa, revisá el nombre que muestra el diálogo y confirmá **Mover etiqueta** solo si corresponde.

Si el teléfono no admite NFC, la app lo indica y no muestra la acción. Si NFC está apagado, activalo desde **Abrir ajustes de NFC**. La asociación requiere internet; conectate antes de empezar.

## Asociar o reemplazar en iPhone

1. Abrí **Modo de configuración** y elegí el predio y punto.
2. Tocá **Asociar etiqueta** o **Reemplazar etiqueta**.
3. Cuando aparezca la ventana de lectura de iOS, acercá la etiqueta al iPhone y mantenelo junto a ella hasta que Garita confirme con vibración, sonido y el mensaje **Etiqueta asociada a {punto}**.
4. Si aparece el diálogo de movimiento, verificá el otro punto antes de confirmar.

## Quitar una etiqueta

En el punto correspondiente, tocá **Quitar etiqueta**. El registro queda en el historial como quitado; después podés asociar otra vez ese UID.

## Verificación manual antes de habilitar dispositivos

- [ ] Android: asociación libre con mensaje, vibración y sonido en menos de 3 segundos.
- [ ] iPhone: la ventana del sistema lee el identificador y completa la asociación en menos de 3 segundos.
- [ ] Reemplazar una etiqueta ya asociada deja vigente solamente la nueva.
- [ ] Mover una etiqueta de otro punto requiere confirmación.
- [ ] Una etiqueta de otra empresa muestra **Etiqueta no disponible**.
- [ ] Sin NFC, NFC apagado y sin conexión muestran sus avisos y no intentan asociar.
- [ ] Probar una etiqueta anti-metal fijada sobre una superficie metálica.

Estas comprobaciones físicas quedan pendientes hasta contar con teléfonos y etiquetas de prueba.
