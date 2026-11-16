/** Mercado Pago's status_detail codes, in words the admin can act on. */
const PAYMENT_DETAIL: Record<string, string> = {
  accredited: 'Acreditado',
  cc_rejected_insufficient_amount: 'Fondos insuficientes',
  cc_rejected_bad_filled_security_code: 'Código de seguridad incorrecto',
  cc_rejected_bad_filled_date: 'Fecha de vencimiento incorrecta',
  cc_rejected_bad_filled_card_number: 'Número de tarjeta incorrecto',
  cc_rejected_bad_filled_other: 'Datos de la tarjeta incorrectos',
  cc_rejected_call_for_authorize: 'El banco pide autorizar el pago',
  cc_rejected_card_disabled: 'Tarjeta deshabilitada',
  cc_rejected_duplicated_payment: 'Pago duplicado',
  cc_rejected_high_risk: 'Rechazado por prevención de fraude',
  cc_rejected_max_attempts: 'Demasiados intentos con esta tarjeta',
  cc_rejected_other_reason: 'El banco rechazó el pago',
};
export const paymentDetail = (code: string | null) => (code ? (PAYMENT_DETAIL[code] ?? code) : '—');
