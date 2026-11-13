import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import type { ShiftOfflineData } from '@garita/shared';
import { colors as palettes, radius, space, touch } from '@garita/tokens';
import { Banner, Button, Card, Loading, Screen, Text } from '@/ui';
import type { Tone } from '@/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { NfcReader } from './nfc-reader';
import { processScan, type ScanActionResult } from './scan-action';

export interface ScannerScreenProps {
  shiftData?: ShiftOfflineData | null;
  onScanComplete?: (result: ScanActionResult) => void;
}

const LINE = 2; // grosor de la línea de barrido (borde fino, como los de src/ui)
const CORNERS = [
  { top: 0, left: 0, borderTopWidth: space[1], borderLeftWidth: space[1] },
  { top: 0, right: 0, borderTopWidth: space[1], borderRightWidth: space[1] },
  { bottom: 0, left: 0, borderBottomWidth: space[1], borderLeftWidth: space[1] },
  { bottom: 0, right: 0, borderBottomWidth: space[1], borderRightWidth: space[1] },
] as const;

/** Visor: cuatro esquinas en L y una línea de barrido (quieta si el sistema pide reducir movimiento). */
function Viewfinder() {
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let mounted = true;
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then((enabled) => mounted && setReduceMotion(enabled !== false))
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion || height === 0) return;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: height,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [height, reduceMotion, sweep]);

  return (
    <View
      style={styles.reticle}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height - LINE)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {CORNERS.map((corner, index) => (
        <View
          key={index}
          style={[styles.corner, corner, { borderColor: cameraColors.foreground }]}
        />
      ))}
      <Animated.View
        style={[
          styles.scanLine,
          { backgroundColor: cameraColors.foreground },
          reduceMotion ? { top: '50%' } : { transform: [{ translateY: sweep }] },
        ]}
      />
    </View>
  );
}

export function ScannerScreen({ shiftData: initialShiftData, onScanComplete }: ScannerScreenProps) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [shiftData, setShiftData] = useState<ShiftOfflineData | null>(initialShiftData ?? null);
  const [loadingShift, setLoadingShift] = useState(!initialShiftData);
  const [torch, setTorch] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanActionResult | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const lastScannedRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialShiftData !== undefined) return;
    let mounted = true;
    void createDefaultFieldRepository()
      .then((repo) => repo.getShiftData())
      .then((data) => {
        if (mounted) {
          setShiftData(data);
          setLoadingShift(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setShiftData(null);
          setLoadingShift(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [initialShiftData]);

  const handleBarcodeScanned = useCallback(
    async (scan: BarcodeScanningResult) => {
      const value = scan.data;
      if (!value || processing || scanned) return;
      if (lastScannedRef.current === value) return;

      lastScannedRef.current = value;
      setScanned(true);
      setProcessing(true);

      if (!shiftData) {
        const errorResult: ScanActionResult = {
          status: 'error',
          message: 'No hay turno activo para registrar puntos',
        };
        setResult(errorResult);
        setFeedbackMessage(errorResult.message);
        setProcessing(false);
        onScanComplete?.(errorResult);
        return;
      }

      try {
        const scanRes = await processScan(value, shiftData);
        setResult(scanRes);
        setFeedbackMessage(scanRes.message);
        onScanComplete?.(scanRes);
      } catch {
        const errorResult: ScanActionResult = {
          status: 'error',
          message: 'Error al procesar el código QR',
        };
        setResult(errorResult);
        setFeedbackMessage(errorResult.message);
        onScanComplete?.(errorResult);
      } finally {
        setProcessing(false);
      }
    },
    [onScanComplete, processing, scanned, shiftData],
  );

  const resetScanner = () => {
    setScanned(false);
    setResult(null);
    setFeedbackMessage('');
    lastScannedRef.current = null;
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (shiftData) {
      router.replace(`/turno/${shiftData.shift.id}`);
    } else {
      router.replace('/(guard)');
    }
  };

  if (loadingShift) {
    return (
      <Screen style={styles.centerContainer}>
        <Loading label="Cargando datos del turno..." />
      </Screen>
    );
  }

  if (!permission) {
    return (
      <Screen style={styles.centerContainer}>
        <Loading label="Verificando permisos de cámara..." />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen scroll style={styles.permissionContent}>
        <Text accessibilityRole="header" variant="title">
          Permiso de cámara necesario
        </Text>
        <Banner tone="info" role="text">
          Se requiere acceso a la cámara para escanear los códigos QR de los puntos de control
          durante tu recorrido.
        </Banner>
        <Button
          label="Habilitar cámara"
          size="lg"
          accessibilityLabel="Habilitar permiso de cámara"
          onPress={() => void requestPermission()}
        />
        {shiftData && <NfcReader shiftData={shiftData} />}
        {feedbackMessage !== '' && <Banner tone="info">{feedbackMessage}</Banner>}
        <Button label="Volver a la ronda" variant="outline" size="lg" onPress={goBack} />
      </Screen>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: cameraColors.background }]}>
      <CameraView
        style={[StyleSheet.absoluteFill, { backgroundColor: cameraColors.background }]}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : (barcode) => void handleBarcodeScanned(barcode)}
      />

      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a la ronda"
            onPress={goBack}
            style={[styles.topButton, cameraControlStyle]}
          >
            <Text style={{ color: cameraColors.foreground }}>← Volver</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={torch ? 'Apagar linterna' : 'Encender linterna'}
            accessibilityState={{ selected: torch }}
            onPress={() => setTorch((prev) => !prev)}
            style={[styles.topButton, cameraControlStyle]}
          >
            <Text style={{ color: cameraColors.foreground }}>
              {torch ? 'Linterna: ON' : 'Linterna: OFF'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.reticleContainer}>
          <Viewfinder />
          <Text style={[styles.reticleHint, cameraControlStyle]}>
            Apuntá al código QR del punto
          </Text>
          <Text style={[styles.reticleHint, cameraControlStyle]}>
            ¿Tiene etiqueta NFC? Acercá la parte de atrás del celular.
          </Text>
        </View>

        <View style={styles.bottomBar}>
          {shiftData && <NfcReader shiftData={shiftData} />}
          {processing && (
            <View style={[styles.processingBox, cameraControlStyle]}>
              <ActivityIndicator size="small" color={cameraColors.foreground} />
              <Text style={{ color: cameraColors.foreground }}>Procesando escaneo...</Text>
            </View>
          )}

          {result && (
            <Card>
              <Banner tone={resultTone(result.status)} accessibilityLiveRegion="assertive">
                {result.message}
              </Banner>
              <Button label="Escanear otro punto" size="lg" onPress={resetScanner} />
              <Button label="Volver a la ronda" variant="outline" size="lg" onPress={goBack} />
            </Card>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

// La cámara conserva la paleta oscura aunque la app use el tema claro.
const cameraColors = palettes.dark;
/** Éxito en verde, demora en ámbar, repetido en azul; lo rechazado o fallido, en rojo. */
function resultTone(status: ScanActionResult['status']): Tone {
  if (status === 'counted') return 'success';
  if (status === 'out_of_window' || status === 'too_soon') return 'warning';
  if (status === 'already_recorded') return 'info';
  return 'danger';
}

const cameraControlStyle = {
  backgroundColor: `${cameraColors.background}D9`,
  color: cameraColors.foreground,
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { justifyContent: 'center', alignItems: 'center' },
  permissionContent: { flexGrow: 1, justifyContent: 'center' },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: space[5],
  },
  topBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topButton: {
    minHeight: touch.min,
    minWidth: touch.min,
    borderRadius: 0,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleContainer: { alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  reticle: { width: '75%', maxWidth: space[16] * 4, aspectRatio: 1, flexShrink: 1 },
  corner: { position: 'absolute', width: space[8], height: space[8] },
  scanLine: { position: 'absolute', left: space[2], right: space[2], height: LINE },
  reticleHint: {
    textAlign: 'center',
    marginTop: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: 0,
  },
  bottomBar: { gap: space[3] },
  processingBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
  },
});
