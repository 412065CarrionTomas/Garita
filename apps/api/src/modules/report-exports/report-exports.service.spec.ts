import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReportsService } from '../reports/reports.service';
import type { IncidentReportsService } from '../reports/incident-reports.service';
import type { PortalService } from '../portal/portal.service';
import { TenantContext } from '../auth/tenant-context';
import { ReportExportsService } from './report-exports.service';

it('registra y mide una falla del servicio conservando usuario, rol, predio y período', async () => {
  const create = jest
    .fn<Promise<{ id: string }>, [unknown]>()
    .mockResolvedValue({ id: 'export-failed' });
  const query = jest.fn().mockRejectedValue(new Error('Fallo de consulta'));
  const context = new TenantContext();
  const user = {
    userId: 'supervisor',
    companyId: 'north',
    role: 'supervisor' as const,
    status: 'active' as const,
  };
  const service = new ReportExportsService(
    { tenantPrisma: { reportExport: { create } } } as unknown as PrismaService,
    { report: query } as unknown as ReportsService,
    {} as IncidentReportsService,
    {} as PortalService,
    context,
    { now: () => new Date('2026-11-16T15:00:00Z') },
  );
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  try {
    await expect(
      context.run({ correlationId: 'pdf-failure', user }, () =>
        service.export(
          'rounds',
          { desde: '2026-10-01', hasta: '2026-11-01', predio: 'assigned' },
          user,
        ),
      ),
    ).rejects.toThrow('Fallo de consulta');
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        userId: 'supervisor',
        role: 'supervisor',
        siteIds: ['assigned'],
        periodStart: '2026-10-01',
        periodEnd: '2026-11-01',
        reportType: 'rounds',
        result: 'failed',
        correlationId: 'pdf-failure',
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'report_export.metric',
        result: 'failed',
        correlationId: 'pdf-failure',
      }),
    );
  } finally {
    log.mockRestore();
  }
});
