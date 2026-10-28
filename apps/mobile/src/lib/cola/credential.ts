import * as SecureStore from 'expo-secure-store';
import { shiftCredentialSchema, type ShiftCredential } from '@garita/shared';

const SHIFT_CREDENTIAL_KEY = 'garita:shift-credential';

interface CredentialStoreDependencies {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  deleteItem(key: string): Promise<void>;
}

const defaultDependencies: CredentialStoreDependencies = {
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  getItem: (key) => SecureStore.getItemAsync(key),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

let overrides: Partial<CredentialStoreDependencies> = {};

export function setCredentialStoreForTesting(next: Partial<CredentialStoreDependencies>): void {
  overrides = next;
}

export function resetCredentialStoreForTesting(): void {
  overrides = {};
}

function deps(): CredentialStoreDependencies {
  return { ...defaultDependencies, ...overrides };
}

export async function saveShiftCredential(credential: ShiftCredential): Promise<void> {
  const validated = shiftCredentialSchema.parse(credential);
  await deps().setItem(SHIFT_CREDENTIAL_KEY, JSON.stringify(validated));
}

export async function getShiftCredential(): Promise<ShiftCredential | null> {
  try {
    const raw = await deps().getItem(SHIFT_CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed = shiftCredentialSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getShiftCredentialToken(): Promise<string | null> {
  const credential = await getShiftCredential();
  return credential?.token ?? null;
}

export async function deleteShiftCredential(): Promise<void> {
  try {
    await deps().deleteItem(SHIFT_CREDENTIAL_KEY);
  } catch {
    // Ignore deletion errors in secure storage
  }
}
