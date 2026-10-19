import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import type { ShiftOfflineData } from '@garita/shared';
import { colors as palettes, radius, space, touch } from '@garita/tokens';
import { Banner, Button, Card, Loading, Screen, Text } from '@/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { nfcAvailability } from '@/lib/nfc';
import { processScan, type ScanActionResult } from './scan-action';

export interface ScannerScreenProps {
  shiftData?: ShiftOfflineData | null;
  onScanComplete?: (result: ScanActionResult) => void;
}

export function ScannerScreen({ shiftData: initialShiftData, onScanComplete }: ScannerScreenProps) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [hasNfc, setHasNfc] = useState<boolean | null>(null);
  const [shiftData, setShiftData] = useState<ShiftOfflineData | null>(initialShiftData ?? null);
  const [loadingShift, setLoadingShift] = useState(!initialShiftData);
  const [torch, setTorch] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanActionResult | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const lastScannedRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void nfcAvailability()
      .then((availability) => {
        if (mounted) {
          setHasNfc(availability !== 'unsupported');
        }
      })
      .catch(() => {
        if (mounted) setHasNfc(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
        {hasNfc && (
          <Card>
            <Text>Tu celular cuenta con lector NFC. Podés utilizarlo como alternativa.</Text>
            <Button
              label="Registrar con NFC"
              variant="secondary"
              size="lg"
              onPress={() =>
                setFeedbackMessage('El registro por NFC estará disponible en la próxima versión.')
              }
            />
          </Card>
        )}
        {feedbackMessage !== '' && <Banner tone="info">{feedbackMessage}</Banner>}
        <Button label="Volver al turno" variant="outline" size="lg" onPress={goBack} />
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
            accessibilityLabel="Volver al turno"
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
          <View style={[styles.reticle, { borderColor: cameraColors.signal }]} />
          <Text style={[styles.reticleHint, cameraControlStyle]}>
            Apuntá al código QR del punto
          </Text>
        </View>

        <View style={styles.bottomBar}>
          {processing && (
            <View style={[styles.processingBox, cameraControlStyle]}>
              <ActivityIndicator size="small" color={cameraColors.signal} />
              <Text style={{ color: cameraColors.foreground }}>Procesando escaneo...</Text>
            </View>
          )}

          {result && (
            <Card>
              <Banner
                tone={result.status === 'counted' ? 'success' : 'danger'}
                accessibilityLiveRegion="assertive"
              >
                {result.message}
              </Banner>
              <Button label="Escanear otro punto" size="lg" onPress={resetScanner} />
              <Button label="Volver al turno" variant="outline" size="lg" onPress={goBack} />
            </Card>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

// La cámara conserva la paleta oscura aunque la app use el tema claro.
const cameraColors = palettes.dark;
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
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleContainer: { alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  reticle: {
    width: '75%',
    maxWidth: space[16] * 4,
    aspectRatio: 1,
    flexShrink: 1,
    borderWidth: space[1],
    borderRadius: radius['2xl'],
  },
  reticleHint: {
    textAlign: 'center',
    marginTop: space[4],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.sm,
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
