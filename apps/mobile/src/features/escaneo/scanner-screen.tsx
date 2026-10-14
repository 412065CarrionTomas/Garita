import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import type { ShiftOfflineData } from '@garita/shared';
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
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#facc15" />
        <Text style={styles.copy}>Cargando datos del turno...</Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#facc15" />
        <Text style={styles.copy}>Verificando permisos de cámara...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionCard}>
          <Text accessibilityRole="header" style={styles.title}>
            Permiso de cámara necesario
          </Text>
          <Text style={styles.copy}>
            Se requiere acceso a la cámara para escanear los códigos QR de los puntos de control
            durante tu recorrido.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Habilitar permiso de cámara"
            onPress={() => void requestPermission()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Habilitar cámara</Text>
          </Pressable>
          {hasNfc && (
            <View style={styles.nfcAlternative}>
              <Text style={styles.copy}>
                Tu celular cuenta con lector NFC. Podés utilizarlo como alternativa.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Registrar con NFC"
                onPress={() =>
                  setFeedbackMessage('El registro por NFC estará disponible en la próxima versión.')
                }
                style={[styles.button, styles.secondaryButton]}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                  Registrar con NFC
                </Text>
              </Pressable>
            </View>
          )}
          {feedbackMessage !== '' && (
            <Text accessibilityRole="alert" style={styles.alertText}>
              {feedbackMessage}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver al turno"
            onPress={goBack}
            style={[styles.button, styles.backButton]}
          >
            <Text style={[styles.buttonText, styles.backButtonText]}>Volver al turno</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : (barcode) => void handleBarcodeScanned(barcode)}
      />

      <View style={styles.overlay}>
        {/* Top Controls */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver al turno"
            onPress={goBack}
            style={styles.topButton}
          >
            <Text style={styles.topButtonText}>← Volver</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={torch ? 'Apagar linterna' : 'Encender linterna'}
            onPress={() => setTorch((prev) => !prev)}
            style={[styles.topButton, torch && styles.torchActiveButton]}
          >
            <Text style={[styles.topButtonText, torch && styles.torchActiveText]}>
              {torch ? 'Linterna: ON' : 'Linterna: OFF'}
            </Text>
          </Pressable>
        </View>

        {/* Reticle / Target Area */}
        <View style={styles.reticleContainer}>
          <View style={styles.reticle} />
          <Text style={styles.reticleHint}>Apuntá al código QR del punto</Text>
        </View>

        {/* Bottom Feedback / Actions */}
        <View style={styles.bottomBar}>
          {processing && (
            <View style={styles.processingBox}>
              <ActivityIndicator size="small" color="#facc15" />
              <Text style={styles.processingText}>Procesando escaneo...</Text>
            </View>
          )}

          {result && (
            <View
              style={[
                styles.resultCard,
                result.status === 'counted' && styles.countedCard,
                result.status === 'out_of_window' && styles.outOfWindowCard,
                (result.status === 'already_recorded' || result.status === 'too_soon') &&
                  styles.warningCard,
                (result.status === 'invalid_attempt' || result.status === 'error') &&
                  styles.errorCard,
              ]}
            >
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.resultText}
              >
                {result.message}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Escanear otro punto"
                onPress={resetScanner}
                style={[styles.button, styles.continueButton]}
              >
                <Text style={styles.buttonText}>Escanear otro punto</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#171717',
    padding: 24,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 32,
  },
  topButton: {
    minHeight: 52,
    minWidth: 110,
    backgroundColor: 'rgba(23, 23, 23, 0.85)',
    borderWidth: 1,
    borderColor: '#777',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  torchActiveButton: {
    backgroundColor: '#facc15',
    borderColor: '#facc15',
  },
  torchActiveText: {
    color: '#171717',
  },
  reticleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#facc15',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  reticleHint: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bottomBar: {
    marginBottom: 20,
    gap: 12,
  },
  processingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(23, 23, 23, 0.9)',
    padding: 16,
    borderRadius: 12,
  },
  processingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  resultCard: {
    padding: 20,
    borderRadius: 12,
    gap: 14,
    alignItems: 'center',
  },
  countedCard: {
    backgroundColor: '#15803d',
  },
  outOfWindowCard: {
    backgroundColor: '#0369a1',
  },
  warningCard: {
    backgroundColor: '#b45309',
  },
  errorCard: {
    backgroundColor: '#b91c1c',
  },
  resultText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  continueButton: {
    width: '100%',
    backgroundColor: '#fff',
  },
  permissionCard: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 20,
  },
  nfcAlternative: {
    gap: 12,
    marginTop: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 10,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
  },
  copy: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 24,
  },
  button: {
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#facc15',
    padding: 16,
  },
  buttonText: {
    color: '#171717',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#3b82f6',
  },
  secondaryButtonText: {
    color: '#fff',
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#777',
    marginTop: 10,
  },
  backButtonText: {
    color: '#fff',
  },
  alertText: {
    color: '#facc15',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
