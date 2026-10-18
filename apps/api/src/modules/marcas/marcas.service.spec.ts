import { NotFoundException } from '@nestjs/common';
import { MarcasService, type EvaluateRecordInput } from './marcas.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';

describe('MarcasService', () => {
  interface CreatedFlag {
    companyId: string;
    checkpointRecordId: string;
    shiftId: string;
    type: string;
    severity: string;
    reason?: string | null;
  }

  const checkpointFindUnique = jest.fn();
  const checkpointRecordFindFirst = jest.fn();
  const checkpointRecordFindMany = jest.fn();
  const recordFlagCreateMany = jest.fn<
    Promise<{ count: number }>,
    [{ data: CreatedFlag[]; skipDuplicates?: boolean }]
  >();
  const shiftFindFirst = jest.fn();
  const siteUpdate = jest.fn();

  const createdFlags = (): CreatedFlag[] => {
    const firstCall = recordFlagCreateMany.mock.calls[0];
    return firstCall?.[0].data ?? [];
  };

  const tenantPrisma = {
    checkpoint: { findUnique: checkpointFindUnique },
    checkpointRecord: {
      findFirst: checkpointRecordFindFirst,
      findMany: checkpointRecordFindMany,
    },
    recordFlag: { createMany: recordFlagCreateMany },
    shift: { findFirst: shiftFindFirst },
    site: { update: siteUpdate },
  };

  const prisma = {
    tenantPrisma,
  } as unknown as PrismaService;

  const findOwnedOrThrow = jest.fn();
  const resources = {
    findOwnedOrThrow,
  } as unknown as TenantResourceService;

  let service: MarcasService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MarcasService(prisma, resources);
  });

  const baseInput: EvaluateRecordInput = {
    id: 'rec-1',
    recordId: '11111111-1111-4111-8111-111111111111',
    shiftId: 'shift-1',
    companyId: 'company-1',
    checkpointId: 'cp-1',
    method: 'qr',
    occurredAtDevice: new Date('2026-10-14T10:00:00.000Z'),
    locationStatus: 'ok',
    latitude: -34.6037,
    longitude: -58.3816,
    accuracyMeters: 10,
    simulation: 'not_simulated',
    phoneNfc: 'on',
  };

  describe('evaluateRecord', () => {
    it('evalúa y guarda marcas correctamente cuando hay fuera de rango', async () => {
      // 80m away from checkpoint, tolerance radius 30m, accuracy 10m
      checkpointFindUnique.mockResolvedValue({
        id: 'cp-1',
        latitude: -34.6037 + 80 / 111195,
        longitude: -58.3816,
        toleranceRadiusMeters: 30,
        isIndoor: false,
        site: { maxSpeedKmh: 10 },
        nfcTags: [],
      });
      checkpointRecordFindFirst.mockResolvedValue(null);
      recordFlagCreateMany.mockResolvedValue({ count: 1 });

      await service.evaluateRecord(baseInput);

      expect(
        createdFlags().some(
          (flag) =>
            flag.companyId === 'company-1' &&
            flag.checkpointRecordId === 'rec-1' &&
            flag.shiftId === 'shift-1' &&
            flag.type === 'out_of_range' &&
            flag.severity === 'media',
        ),
      ).toBe(true);
    });

    it('guarda ubicación simulada como grave', async () => {
      checkpointFindUnique.mockResolvedValue({
        id: 'cp-1',
        latitude: -34.6037,
        longitude: -58.3816,
        toleranceRadiusMeters: 30,
        isIndoor: false,
        site: { maxSpeedKmh: 10 },
        nfcTags: [],
      });
      checkpointRecordFindFirst.mockResolvedValue(null);

      await service.evaluateRecord({
        ...baseInput,
        simulation: 'simulated',
      });

      expect(
        createdFlags().some(
          (flag) => flag.type === 'simulated_location' && flag.severity === 'grave',
        ),
      ).toBe(true);
    });

    it('marca qr_on_tagged_point cuando hay etiqueta activa y método qr', async () => {
      checkpointFindUnique.mockResolvedValue({
        id: 'cp-1',
        latitude: -34.6037,
        longitude: -58.3816,
        toleranceRadiusMeters: 30,
        isIndoor: false,
        site: { maxSpeedKmh: 10 },
        nfcTags: [{ id: 'tag-1' }],
      });
      checkpointRecordFindFirst.mockResolvedValue(null);

      await service.evaluateRecord({
        ...baseInput,
        phoneNfc: 'off',
      });

      expect(
        createdFlags().some(
          (flag) =>
            flag.type === 'qr_on_tagged_point' &&
            flag.severity === 'media' &&
            flag.reason === 'nfc_off',
        ),
      ).toBe(true);
    });

    it('evalúa tiempo imposible con el registro anterior del turno', async () => {
      // Current checkpoint
      checkpointFindUnique.mockResolvedValue({
        id: 'cp-1',
        latitude: -34.6037,
        longitude: -58.3816,
        toleranceRadiusMeters: 30,
        isIndoor: false,
        site: { maxSpeedKmh: 10 },
        nfcTags: [],
      });
      // Previous checkpoint was 500m away, 30 seconds ago (60 km/h > 10 km/h)
      checkpointRecordFindFirst.mockResolvedValue({
        occurredAtDevice: new Date('2026-10-14T09:59:30.000Z'),
        checkpoint: {
          id: 'cp-prev',
          latitude: -34.6037 - 500 / 111195,
          longitude: -58.3816,
        },
      });

      await service.evaluateRecord(baseInput);

      expect(
        createdFlags().some(
          (flag) =>
            flag.type === 'impossible_time' &&
            flag.severity === 'grave' &&
            flag.reason === 'speed_exceeded',
        ),
      ).toBe(true);
    });

    it('si el checkpoint no existe, no falla ni crea marcas', async () => {
      checkpointFindUnique.mockResolvedValue(null);

      await expect(service.evaluateRecord(baseInput)).resolves.not.toThrow();
      expect(recordFlagCreateMany).not.toHaveBeenCalled();
    });

    it('si la base de datos falla al guardar marcas, captura el error y no lanza excepción (CA5)', async () => {
      checkpointFindUnique.mockRejectedValue(new Error('DB connection failure'));

      await expect(service.evaluateRecord(baseInput)).resolves.not.toThrow();
    });
  });

  describe('getShiftRecords', () => {
    const adminUser = {
      userId: 'admin-1',
      companyId: 'company-1',
      role: 'admin' as const,
      status: 'active' as const,
    };

    it('lanza 404 si el turno no existe o no pertenece al tenant', async () => {
      shiftFindFirst.mockResolvedValue(null);

      await expect(service.getShiftRecords('shift-999', {}, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devuelve los registros con sus marcas y phoneWithoutNfc = false si no hay celulares sin NFC', async () => {
      shiftFindFirst.mockResolvedValue({ id: 'shift-1', siteId: 'site-1' });
      checkpointRecordFindMany.mockResolvedValue([
        {
          id: 'rec-1',
          recordId: '11111111-1111-4111-8111-111111111111',
          shiftId: 'shift-1',
          checkpointId: 'cp-1',
          method: 'qr',
          occurredAtDevice: new Date('2026-10-14T10:00:00.000Z'),
          receivedAt: new Date('2026-10-14T10:00:01.000Z'),
          locationStatus: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          phoneNfc: 'on',
          outOfWindow: false,
          countsForCompliance: true,
          flags: [
            {
              id: 'flag-1',
              type: 'qr_on_tagged_point',
              severity: 'media',
              reason: 'nfc_on',
              details: { phoneNfc: 'on' },
              createdAt: new Date('2026-10-14T10:00:01.000Z'),
            },
          ],
        },
      ]);

      const result = await service.getShiftRecords('shift-1', {}, adminUser);

      expect(result.shiftId).toBe('shift-1');
      expect(result.phoneWithoutNfc).toBe(false);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.flags).toHaveLength(1);
      expect(result.records[0]?.flags[0]?.type).toBe('qr_on_tagged_point');
    });

    it('reporta phoneWithoutNfc = true cuando algún registro tiene phoneNfc: unsupported', async () => {
      shiftFindFirst.mockResolvedValue({ id: 'shift-1', siteId: 'site-1' });
      checkpointRecordFindMany.mockResolvedValue([
        {
          id: 'rec-1',
          recordId: '11111111-1111-4111-8111-111111111111',
          shiftId: 'shift-1',
          checkpointId: 'cp-1',
          method: 'qr',
          occurredAtDevice: new Date('2026-10-14T10:00:00.000Z'),
          receivedAt: new Date('2026-10-14T10:00:01.000Z'),
          locationStatus: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          phoneNfc: 'unsupported',
          outOfWindow: false,
          countsForCompliance: true,
          flags: [],
        },
      ]);

      const result = await service.getShiftRecords('shift-1', {}, adminUser);

      expect(result.phoneWithoutNfc).toBe(true);
      expect(result.records[0]?.flags).toHaveLength(0);
    });

    it('con marcados = true, filtra únicamente los registros con marcas', async () => {
      shiftFindFirst.mockResolvedValue({ id: 'shift-1', siteId: 'site-1' });
      checkpointRecordFindMany.mockResolvedValue([
        {
          id: 'rec-1',
          recordId: '11111111-1111-4111-8111-111111111111',
          shiftId: 'shift-1',
          checkpointId: 'cp-1',
          method: 'qr',
          occurredAtDevice: new Date('2026-10-14T10:00:00.000Z'),
          receivedAt: new Date('2026-10-14T10:00:01.000Z'),
          locationStatus: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'not_simulated',
          phoneNfc: 'on',
          outOfWindow: false,
          countsForCompliance: true,
          flags: [],
        },
        {
          id: 'rec-2',
          recordId: '22222222-2222-4222-8222-222222222222',
          shiftId: 'shift-1',
          checkpointId: 'cp-2',
          method: 'qr',
          occurredAtDevice: new Date('2026-10-14T10:05:00.000Z'),
          receivedAt: new Date('2026-10-14T10:05:01.000Z'),
          locationStatus: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          accuracyMeters: 10,
          simulation: 'simulated',
          phoneNfc: 'on',
          outOfWindow: false,
          countsForCompliance: true,
          flags: [
            {
              id: 'flag-2',
              type: 'simulated_location',
              severity: 'grave',
              reason: 'simulated_location_detected',
              details: null,
              createdAt: new Date('2026-10-14T10:05:01.000Z'),
            },
          ],
        },
      ]);

      const result = await service.getShiftRecords('shift-1', { marcados: true }, adminUser);

      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.id).toBe('rec-2');
    });
  });

  describe('updateSiteSpeed', () => {
    const adminUser = {
      userId: 'admin-1',
      companyId: 'company-1',
      role: 'admin' as const,
      status: 'active' as const,
    };

    it('actualiza perfil walking con velocidad por defecto (10 km/h)', async () => {
      findOwnedOrThrow.mockResolvedValue({ id: 'site-1' });
      siteUpdate.mockResolvedValue({
        id: 'site-1',
        maxSpeedProfile: 'walking',
        maxSpeedKmh: 10,
      });

      const updated = await service.updateSiteSpeed(
        'site-1',
        { maxSpeedProfile: 'walking' },
        adminUser,
      );

      expect(findOwnedOrThrow).toHaveBeenCalledWith('Site', 'site-1');
      expect(siteUpdate).toHaveBeenCalledWith({
        where: { id: 'site-1' },
        data: { maxSpeedProfile: 'walking', maxSpeedKmh: 10 },
      });
      expect(updated.maxSpeedKmh).toBe(10);
    });

    it('actualiza perfil vehicle con velocidad por defecto (60 km/h)', async () => {
      findOwnedOrThrow.mockResolvedValue({ id: 'site-1' });
      siteUpdate.mockResolvedValue({
        id: 'site-1',
        maxSpeedProfile: 'vehicle',
        maxSpeedKmh: 60,
      });

      await service.updateSiteSpeed('site-1', { maxSpeedProfile: 'vehicle' }, adminUser);

      expect(siteUpdate).toHaveBeenCalledWith({
        where: { id: 'site-1' },
        data: { maxSpeedProfile: 'vehicle', maxSpeedKmh: 60 },
      });
    });

    it('actualiza perfil custom con velocidad personalizada', async () => {
      findOwnedOrThrow.mockResolvedValue({ id: 'site-1' });
      siteUpdate.mockResolvedValue({
        id: 'site-1',
        maxSpeedProfile: 'custom',
        maxSpeedKmh: 45,
      });

      await service.updateSiteSpeed(
        'site-1',
        { maxSpeedProfile: 'custom', maxSpeedKmh: 45 },
        adminUser,
      );

      expect(siteUpdate).toHaveBeenCalledWith({
        where: { id: 'site-1' },
        data: { maxSpeedProfile: 'custom', maxSpeedKmh: 45 },
      });
    });

    it('si findOwnedOrThrow falla (ej. supervisor no asignado), lanza error', async () => {
      findOwnedOrThrow.mockRejectedValue(new NotFoundException('Recurso no encontrado'));

      await expect(
        service.updateSiteSpeed('site-999', { maxSpeedProfile: 'walking' }, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
