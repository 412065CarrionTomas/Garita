import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  PermissionsAndroid,
  Platform,
  Alert,
} from 'react-native';
import {
  hasSendSmsPermission,
  sendSmsInBackground,
  addSmsSentListener,
  addSmsDeliveredListener,
  SmsSentEvent,
  SmsDeliveredEvent,
} from '../src/index';

export default function App() {
  const [phoneNumber, setPhoneNumber] = useState('+5493511234567');
  const [message, setMessage] = useState(
    'GARITA PANICO K7Q2M9XA T:483920 03:10 -31.42013,-64.18877',
  );
  const [hasPermission, setHasPermission] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);

  const addLog = (text: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${text}`, ...prev]);
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      const granted = hasSendSmsPermission();
      setHasPermission(granted);
      addLog(`Permiso SEND_SMS inicial: ${granted ? 'CONCEDIDO' : 'DENEGADO'}`);
    }

    const sentSub = addSmsSentListener((event: SmsSentEvent) => {
      addLog(`📡 ACUSE DE ENVÍO (Sent): Estado = ${event.status} (code: ${event.resultCode})`);
      if (event.status === 'OK') {
        addLog('✅ Mensaje emitido por el módem hacia la red celular');
      } else {
        addLog(`❌ Fallo en transmisión celular: ${event.status}`);
      }
    });

    const deliveredSub = addSmsDeliveredListener((event: SmsDeliveredEvent) => {
      addLog(
        `📬 ACUSE DE ENTREGA (Delivered): ${event.delivered ? 'ENTREGADO AL DESTINATARIO' : 'FALLIDO'} (code: ${event.resultCode})`,
      );
    });

    return () => {
      sentSub.remove();
      deliveredSub.remove();
    };
  }, []);

  const requestPermission = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
        title: 'Permiso para Alertas de Emergencia',
        message:
          'Garita necesita permiso para enviar SMS de emergencia en segundo plano cuando no hay datos móviles.',
        buttonPositive: 'Permitir',
        buttonNegative: 'Cancelar',
      });
      const isGranted = granted === PermissionsAndroid.RESULTS.GRANTED;
      setHasPermission(isGranted);
      addLog(`Solicitud de permiso resultado: ${granted}`);
    } catch (err: any) {
      addLog(`Error al pedir permiso: ${err.message}`);
    }
  };

  const handleSend = async () => {
    if (!hasPermission) {
      Alert.alert(
        'Sin permiso',
        'Debe conceder el permiso SEND_SMS para probar el envío en segundo plano.',
      );
      return;
    }

    try {
      setIsSending(true);
      addLog(`Iniciando envío en 2do plano a ${phoneNumber}...`);
      const res = await sendSmsInBackground(phoneNumber, message);
      addLog(`Despacho iniciado. Id: ${res.messageId}, Longitud: ${res.charLength} caracteres`);
    } catch (err: any) {
      addLog(`Error al despachar SMS: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>PoC HU-36: SEND_SMS Android</Text>
      <Text style={styles.subtitle}>Envío en segundo plano sin UI del sistema</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Estado del permiso SEND_SMS:</Text>
        <Text style={[styles.status, hasPermission ? styles.ok : styles.danger]}>
          {hasPermission ? 'CONCEDIDO (Envío automático habilitado)' : 'NO CONCEDIDO'}
        </Text>
        {!hasPermission && (
          <TouchableOpacity style={styles.buttonSecondary} onPress={requestPermission}>
            <Text style={styles.buttonTextSecondary}>Solicitar Permiso</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Número de Destino (formato internacional o local):</Text>
        <TextInput
          style={styles.input}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder="+549..."
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Texto del Pánico (160 caracteres GSM 7-bit max):</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={message}
          onChangeText={setMessage}
          multiline
        />
        <Text style={styles.charCount}>{message.length} / 160 caracteres</Text>

        <TouchableOpacity
          style={[styles.buttonPrimary, isSending && styles.buttonDisabled]}
          onPress={handleSend}
          disabled={isSending}
        >
          <Text style={styles.buttonTextPrimary}>
            {isSending ? 'Enviando...' : 'ACTIVAR PÁNICO (SEND_SMS)'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Registro de Eventos y Acuses (BroadcastReceivers):</Text>
        {logs.map((log, idx) => (
          <Text key={idx} style={styles.logText}>
            {log}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f3f4f6' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#4b5563', marginBottom: 16 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  status: { fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  ok: { color: '#059669' },
  danger: { color: '#dc2626' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    marginBottom: 12,
    backgroundColor: '#f9fafb',
  },
  textArea: { minHeight: 60 },
  charCount: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: -8,
    marginBottom: 12,
  },
  buttonPrimary: { backgroundColor: '#b91c1c', padding: 14, borderRadius: 6, alignItems: 'center' },
  buttonSecondary: {
    backgroundColor: '#e5e7eb',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonTextPrimary: { color: '#ffffff', fontWeight: 'bold', fontSize: 15 },
  buttonTextSecondary: { color: '#1f2937', fontWeight: '600', fontSize: 13 },
  logText: { fontSize: 11, fontFamily: 'monospace', color: '#1f2937', marginVertical: 2 },
});
