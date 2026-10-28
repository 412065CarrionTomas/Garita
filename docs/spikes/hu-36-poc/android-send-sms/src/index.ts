import { EventEmitter, NativeModulesProxy, Subscription } from 'expo-modules-core';

export interface SmsSentEvent {
  messageId: string;
  phoneNumber: string;
  status: 'OK' | 'GENERIC_FAILURE' | 'NO_SERVICE' | 'NULL_PDU' | 'RADIO_OFF' | string;
  resultCode: number;
  timestamp: number;
}

export interface SmsDeliveredEvent {
  messageId: string;
  phoneNumber: string;
  delivered: boolean;
  resultCode: number;
  timestamp: number;
}

export interface SendSmsResult {
  messageId: string;
  dispatched: boolean;
  charLength: number;
}

// Proxy nativo de Expo Modules API
const GaritaSendSms = NativeModulesProxy.GaritaSendSms;
const emitter = new EventEmitter(GaritaSendSms);

export function hasSendSmsPermission(): boolean {
  if (!GaritaSendSms || typeof GaritaSendSms.hasPermission !== 'function') {
    return false;
  }
  return GaritaSendSms.hasPermission();
}

export async function sendSmsInBackground(
  phoneNumber: string,
  messageText: string,
): Promise<SendSmsResult> {
  if (!GaritaSendSms || typeof GaritaSendSms.sendSmsInBackground !== 'function') {
    throw new Error('Módulo GaritaSendSms no disponible en esta plataforma');
  }
  return await GaritaSendSms.sendSmsInBackground(phoneNumber, messageText);
}

export function addSmsSentListener(listener: (event: SmsSentEvent) => void): Subscription {
  return emitter.addListener<SmsSentEvent>('onSmsSent', listener);
}

export function addSmsDeliveredListener(
  listener: (event: SmsDeliveredEvent) => void,
): Subscription {
  return emitter.addListener<SmsDeliveredEvent>('onSmsDelivered', listener);
}
