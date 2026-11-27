# Asociar etiquetas NFC a puntos de control

La asociación se hace con conexión a internet desde el modo de configuración. La app guarda el identificador de fábrica de la etiqueta; no escribe datos en ella. Usá etiquetas NFC compatibles con el teléfono. Para fijarlas sobre metal, elegí etiquetas anti-metal.

## Instalar el build de desarrollo

El modo NFC requiere instalar un development build de Garita, porque Expo Go no incluye el módulo nativo. El administrador del proyecto puede generar un build Android con:

```bash
pnpm dlx eas-cli@latest build --profile development --platform android
```

Instalá el APK/enlace entregado por EAS y abrí Garita. Iniciá sesión como administrador o supervisor. El administrador puede configurar todos los predios activos de su empresa; el supervisor ve los predios que tiene asignados.

## Asociar etiquetas (Android)

La asociación se hace desde la oficina, con las etiquetas en la mano: la ubicación de cada punto es la que se cargó en el panel web.

1. En **Etiquetas NFC** elegí el predio. Los predios con puntos sin etiqueta aparecen primero, con cuántos faltan.
2. En el predio, los puntos van en el orden de la ronda. Tocá **Etiquetar pendientes** para recorrerlos en serie, o tocá un punto para asociar solo ese.
3. Se abre la hoja de escaneo: acercá la parte trasera del teléfono a la etiqueta. Todo lo que pasa (lectura, configuración segura, lectura de prueba, errores) se ve en esa hoja.
4. Al asociar, la app confirma con vibración y sonido y muestra en grande el número y nombre del punto: **escribilo en la etiqueta** antes de seguir.
5. En serie, tocá **Siguiente** para pasar al próximo punto, o activá **Pasar solo al siguiente** para que avance sin tocar nada.
6. Si la etiqueta ya es de otro punto de la empresa, la hoja lo dice: confirmá **Mover a {punto}** solo si corresponde, o leé otra etiqueta.

Si el teléfono no admite NFC, la app lo indica y no deja escanear. Si NFC está apagado, activalo desde **Activar NFC**; al volver a la app el aviso desaparece solo. La asociación requiere internet.

La app lee etiquetas NFC-A (NfcA) y NFC-V / ISO 15693 (NfcV), incluidas etiquetas industriales de UID de 8 bytes como ICODE SLIX. Para instalar una etiqueta sobre metal, usá una etiqueta anti-metal.

## Asociar etiquetas (iPhone)

El recorrido es el mismo. Cuando aparezca la ventana de lectura de iOS, acercá la etiqueta al iPhone y mantenelo junto a ella hasta que Garita confirme.

La lectura de iOS usa la sesión de etiquetas del sistema y lee el UID de fábrica, incluso si la etiqueta está virgen y todavía no tiene contenido NDEF. Se admiten etiquetas MIFARE y NFC-V / ISO 15693.

## Reemplazar o quitar una etiqueta

En el predio, tocá **Todos** y elegí el punto. **Reemplazar etiqueta** lee una nueva y deja vigente solo esa. **Quitar etiqueta** pide confirmación; el registro queda en el historial como quitado y después podés asociar otra vez ese UID.

## Identificar una etiqueta

Desde el inicio, tocá **Identificar etiqueta** y acercá una etiqueta suelta. La app dice a qué punto y predio pertenece, si es segura o común, desde cuándo está en uso y cuándo la marcó un vigilador por última vez. Si fue reemplazada o quitada, lo avisa; si no es de ningún punto, se puede usar en cualquiera.

## Verificación manual antes de habilitar dispositivos

- [ ] Android: asociación libre con mensaje, vibración y sonido en menos de 3 segundos.
- [ ] Android: una etiqueta ISO 15693 / NFC-V de 8 bytes se lee y queda asociada.
- [ ] iPhone: una etiqueta virgen, sin formato NDEF, se lee desde la ventana del sistema y queda asociada en menos de 3 segundos.
- [ ] iPhone: una etiqueta ISO 15693 / NFC-V se lee y queda asociada.
- [ ] Reemplazar una etiqueta ya asociada deja vigente solamente la nueva.
- [ ] Mover una etiqueta de otro punto requiere confirmación.
- [ ] En serie, **Pasar solo al siguiente** avanza al próximo punto después de asociar.
- [ ] **Identificar etiqueta** muestra el punto de una etiqueta asociada y avisa si no es de ninguno.
- [ ] Una etiqueta de otra empresa muestra **Esta etiqueta no está disponible para tu empresa.**
- [ ] Sin NFC, NFC apagado y sin conexión muestran sus avisos y no intentan asociar.
- [ ] Probar una etiqueta anti-metal fijada sobre una superficie metálica.

Estas comprobaciones físicas quedan pendientes hasta contar con teléfonos y etiquetas de prueba.
