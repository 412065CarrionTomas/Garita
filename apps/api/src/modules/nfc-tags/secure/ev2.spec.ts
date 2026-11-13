import { aesBlock, aesCbc } from './crypto';
import {
  FACTORY_KEY,
  changeKey,
  authContinue,
  authFirst,
  checkFullResponse,
  finishAuth,
  fullCommand,
  ndefTemplate,
  sessionKeys,
} from './ev2';

describe('EV2 relay vectors', () => {
  // NXP AN12196 rev. 2.0, section 5.6, Table 14.
  const rndA = Buffer.from('13C5DB8A5930439FC3DEF9A4C675360F', 'hex');
  const first = Buffer.from('A04C124213C186F22399D33AC2A3021591AF', 'hex');
  const second = Buffer.from(
    '3FA64DB5446D1F34CD6EA311167F5E4985B89690C04A05F17FA7AB2F081206639100',
    'hex',
  );

  it('builds AuthenticateEV2First APDUs and session keys from AN12196 Table 14', () => {
    expect(authFirst()).toBe('9071000002000000');
    const continuation = authContinue(first, FACTORY_KEY, rndA);
    expect(continuation.command).toBe(
      '90AF00002035C3E05A752E0144BAC0DE51C1F22C56B34408A23D8AEA266CAB947EA8E0118D00',
    );
    const state = finishAuth(second, FACTORY_KEY, continuation.state);
    expect(state.ti?.toUpperCase()).toBe('9D00C4DF');
    const keys = sessionKeys(FACTORY_KEY, state);
    expect(keys.enc.toString('hex').toUpperCase()).toBe('1309C877509E5A215007FF0ED19CA564');
    expect(keys.mac.toString('hex').toUpperCase()).toBe('4C6626F5E72EA694202139295C7A7FC7');
  });

  it('builds and checks the ChangeFileSettings secure APDU from AN12196 Table 18', () => {
    const state = finishAuth(second, FACTORY_KEY, authContinue(first, FACTORY_KEY, rndA).state);
    const command = fullCommand(
      0x5f,
      Buffer.from([2]),
      Buffer.from('4000E0C1F121200000430000430000', 'hex'),
      1,
      state,
      FACTORY_KEY,
    );
    expect(command).toBe('905F0000190261B6D97903566E84C3AE5274467E89EAD799B7C1A0EF7A0400');
    expect(() => {
      checkFullResponse(Buffer.from('57BFF87B1241E93D9100', 'hex'), 1, state, FACTORY_KEY);
    }).not.toThrow();
    expect(() => {
      checkFullResponse(Buffer.from('57BFF87B1241E93C9100', 'hex'), 1, state, FACTORY_KEY);
    }).toThrow();
  });

  it('places encrypted PICCData and CMAC placeholders at non-overlapping NDEF offsets', () => {
    const template = ndefTemplate();
    expect(
      template.data.subarray(template.piccOffset, template.piccOffset + 32).toString('ascii'),
    ).toBe('0'.repeat(32));
    expect(
      template.data.subarray(template.macOffset, template.macOffset + 16).toString('ascii'),
    ).toBe('0'.repeat(16));
  });
});

// AN12196 ChangeKey Case 1: nonzero old key requires XOR; CRC is always over the new key.
it.each([Buffer.alloc(16), Buffer.from('F3847D627727ED3BC9C4CC050489B966', 'hex')])(
  'ChangeKey masks a non-authenticated slot with its actual old key %j',
  (oldKey) => {
    const state = {
      rndA: '13c5db8a5930439fc3def9a4c675360f',
      rndB: '00112233445566778899aabbccddeeff',
      ti: '11223344',
    };
    const newKey = Buffer.from('F3847D627727ED3BC9C4CC050489B966', 'hex');
    const command = Buffer.from(changeKey(2, newKey, 1, 0, state, FACTORY_KEY, oldKey), 'hex');
    const { enc } = sessionKeys(FACTORY_KEY, state);
    const iv = aesBlock(enc, Buffer.from('a55a1122334400000000000000000000', 'hex'));
    const plain = aesCbc(enc, iv, command.subarray(6, -9), true);
    expect(plain.subarray(0, 16)).toEqual(
      Buffer.from(newKey.map((byte, i) => byte ^ (oldKey[i] ?? 0))),
    );
    expect(plain.subarray(16, 21).toString('hex').toUpperCase()).toBe('01789DFADC');
  },
);
