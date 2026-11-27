import { adminSummaryCatalog } from '@garita/shared';
import { describeSummaryBlock } from './block-descriptions';

describe('describeSummaryBlock', () => {
  const ids = Object.keys(
    adminSummaryCatalog.widgets,
  ) as (keyof typeof adminSummaryCatalog.widgets)[];

  it.each(ids)('%s ofrece exactamente las presentaciones del catálogo, en su orden', (id) => {
    expect(describeSummaryBlock(id).presentations.map((choice) => choice.value)).toEqual(
      adminSummaryCatalog.widgets[id].presentations,
    );
  });

  it.each(ids)('cada opción de ajuste de %s es válida para el catálogo', (id) => {
    const { settings } = adminSummaryCatalog.widgets[id];
    const defaults = settings.parse({});
    for (const field of describeSummaryBlock(id).settings) {
      expect(Object.keys(defaults)).toContain(field.key);
      for (const option of field.options)
        expect(settings.safeParse({ ...defaults, [field.key]: option.value }).success).toBe(true);
    }
  });

  it('todas las presentaciones tienen nombre visible', () => {
    for (const id of ids)
      for (const choice of describeSummaryBlock(id).presentations)
        expect(choice.label).not.toBe(choice.value);
  });
});
