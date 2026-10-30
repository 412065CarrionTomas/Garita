import { Alert, PermissionsAndroid, Platform } from 'react-native';
import type { FieldRepository } from '@/lib/db/database';
import { requestPanicSmsPermission } from './sms-permission';

describe('SMS permission before emergencies', () => {
  const meta = new Map<string, string>();
  const repository = {
    getSyncMeta: async (key: string) => meta.get(key) ?? null,
    setSyncMeta: async (key: string, value: string) => {
      meta.set(key, value);
    },
  } as FieldRepository;
  beforeEach(() => {
    meta.clear();
    jest.replaceProperty(Platform, 'OS', 'android');
  });
  afterEach(() => jest.restoreAllMocks());

  it('explains exclusive emergency use before asking Android and never asks twice per shift', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    const explain = jest.spyOn(Alert, 'alert').mockImplementation((_title, message, buttons) => {
      expect(message).toContain('exclusivamente');
      expect(request).not.toHaveBeenCalled();
      buttons?.find((button) => button.text === 'Continuar')?.onPress?.();
    });
    await requestPanicSmsPermission(repository, 'shift');
    await requestPanicSmsPermission(repository, 'shift');
    expect(explain).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  });

  it('allows declining the disclosure without requesting or insisting during that shift', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    const request = jest.spyOn(PermissionsAndroid, 'request');
    const explain = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) =>
        buttons?.find((button) => button.text === 'Ahora no')?.onPress?.(),
      );
    await requestPanicSmsPermission(repository, 'shift');
    await requestPanicSmsPermission(repository, 'shift');
    expect(request).not.toHaveBeenCalled();
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it('never requests SEND_SMS on iPhone', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const request = jest.spyOn(PermissionsAndroid, 'request');
    const explain = jest.spyOn(Alert, 'alert');
    await requestPanicSmsPermission(repository, 'shift');
    expect(request).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
  });
});
