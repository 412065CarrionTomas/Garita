export const ARM_DURATION_MS = 5000;

export function panicGesture(
  action: 'panic' | 'confirm' | 'timeout',
  now: number,
  armedUntil: number,
): { fire: boolean; armedUntil: number } {
  if (action === 'timeout') return { fire: false, armedUntil: now < armedUntil ? armedUntil : 0 };
  if (action === 'confirm' && now < armedUntil) return { fire: true, armedUntil: 0 };
  return { fire: false, armedUntil: now + ARM_DURATION_MS };
}
