import { FOLLOW_UP_TRANSITIONS } from './incident-classification.service';

describe('seguimiento de incidentes', () => {
  it('cada acción exige el estado previo correcto', () => {
    expect(FOLLOW_UP_TRANSITIONS.note).toEqual({ from: 'open', to: 'open' });
    expect(FOLLOW_UP_TRANSITIONS.close).toEqual({ from: 'open', to: 'closed' });
    expect(FOLLOW_UP_TRANSITIONS.reopen).toEqual({ from: 'closed', to: 'open' });
  });
});
