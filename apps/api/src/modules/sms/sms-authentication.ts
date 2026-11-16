import { parsePanicSms, sameArPhone, type SmsInboundAuthResult } from '@garita/shared';

export interface SmsShiftCandidate {
  id: string;
  companyId: string;
  panicSmsCode: string | null;
  assignmentId: string;
  guardId: string;
  phone: string | null;
}

/** Candidates are current, active assignments of shifts in progress. Never guess ambiguous ownership. */
export function authenticatePanicSms(text: string, from: string, candidates: SmsShiftCandidate[]) {
  const parsed = parsePanicSms(text);
  const byCode = parsed ? candidates.filter((row) => row.panicSmsCode === parsed.shiftCode) : [];
  const byPhone = candidates.filter((row) => row.phone && sameArPhone(row.phone, from));
  const result: SmsInboundAuthResult =
    byCode.length === 1
      ? 'valid'
      : byCode.length === 0 && byPhone.length === 1
        ? 'unverified'
        : 'unknown';
  const candidate =
    result === 'valid' ? byCode[0] : result === 'unverified' ? byPhone[0] : undefined;
  const companies = new Set(byPhone.map((row) => row.companyId));
  return {
    result,
    candidate,
    parsed,
    phoneMismatch: result === 'valid' && (!candidate?.phone || !sameArPhone(candidate.phone, from)),
    companyId: candidate?.companyId ?? (companies.size === 1 ? byPhone[0]?.companyId : undefined),
  };
}
