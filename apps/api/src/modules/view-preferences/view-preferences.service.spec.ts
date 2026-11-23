import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { adminSummaryCatalog, VIEW_PREFERENCE_CONFLICT_CODE } from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { viewCatalogFor } from './view-access';
import { ViewPreferencesService } from './view-preferences.service';

const admin: AuthenticatedUser = {
  userId: 'me',
  companyId: 'norte',
  role: 'admin',
  status: 'active',
};
const savedAt = new Date('2026-11-23T10:00:00.000Z');

function setup() {
  const delegate = {
    findFirst: jest.fn().mockResolvedValue(null),
    findFirstOrThrow: jest.fn().mockResolvedValue({ updatedAt: savedAt }),
    create: jest.fn().mockResolvedValue({ updatedAt: savedAt }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const service = new ViewPreferencesService({
    tenantPrisma: { userViewPreference: delegate },
  } as unknown as PrismaService);
  return { delegate, service };
}
const layout = () => structuredClone(adminSummaryCatalog.defaultLayout);

describe('viewCatalogFor', () => {
  it('da 404 a pantallas desconocidas y 403 a roles sin acceso', () => {
    expect(viewCatalogFor('admin-summary', admin)).toBe(adminSummaryCatalog);
    expect(() => viewCatalogFor('otra', admin)).toThrow(NotFoundException);
    expect(() => viewCatalogFor('admin-summary', { ...admin, role: 'supervisor' })).toThrow(
      ForbiddenException,
    );
  });
});

describe('ViewPreferencesService', () => {
  it('sin diseño guardado devuelve null y lee solo el del usuario', async () => {
    const { delegate, service } = setup();
    expect(await service.get(adminSummaryCatalog, admin)).toEqual({
      layout: null,
      updatedAt: null,
    });
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'me', viewKey: 'admin-summary' } }),
    );
  });

  it('reconcilia el diseño guardado con el catálogo actual', async () => {
    const { delegate, service } = setup();
    delegate.findFirst.mockResolvedValue({
      layout: { version: 1, items: [{ id: 'borrado' }] },
      updatedAt: savedAt,
    });
    const result = await service.get(adminSummaryCatalog, admin);
    expect(result.updatedAt).toBe(savedAt.toISOString());
    expect(result.layout?.items.map((item) => item.id).sort()).toEqual(
      Object.keys(adminSummaryCatalog.widgets).sort(),
    );
  });

  it('rechaza un diseño que no respeta el catálogo, sin escribir', async () => {
    const { delegate, service } = setup();
    const invalid = layout();
    const first = invalid.items[0];
    if (first) first.w = 99;
    await expect(
      service.put(adminSummaryCatalog, { layout: invalid, baseUpdatedAt: null }, admin),
    ).rejects.toThrow(BadRequestException);
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('crea el primer diseño con la empresa y la versión del catálogo', async () => {
    const { delegate, service } = setup();
    const result = await service.put(
      adminSummaryCatalog,
      { layout: layout(), baseUpdatedAt: null },
      admin,
    );
    expect(result.updatedAt).toBe(savedAt.toISOString());
    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'me',
          companyId: 'norte',
          viewKey: 'admin-summary',
          version: adminSummaryCatalog.version,
        }) as unknown,
      }),
    );
  });

  it('actualiza solo si nadie guardó desde la fecha base', async () => {
    const { delegate, service } = setup();
    await service.put(
      adminSummaryCatalog,
      { layout: layout(), baseUpdatedAt: savedAt.toISOString() },
      admin,
    );
    expect(delegate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'me', viewKey: 'admin-summary', updatedAt: savedAt },
      }),
    );
  });

  it('responde 409 si otra pestaña guardó antes', async () => {
    const { delegate, service } = setup();
    delegate.updateMany.mockResolvedValue({ count: 0 });
    const stale = service.put(
      adminSummaryCatalog,
      { layout: layout(), baseUpdatedAt: savedAt.toISOString() },
      admin,
    );
    await expect(stale).rejects.toThrow(ConflictException);
    delegate.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const error = await service
      .put(adminSummaryCatalog, { layout: layout(), baseUpdatedAt: null }, admin)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: VIEW_PREFERENCE_CONFLICT_CODE,
    });
  });

  it('restablecer borra solo el diseño del usuario en esa pantalla', async () => {
    const { delegate, service } = setup();
    await service.reset(adminSummaryCatalog, admin);
    expect(delegate.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'me', viewKey: 'admin-summary' },
    });
  });
});
