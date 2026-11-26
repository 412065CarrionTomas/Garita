import { FOLLOW_UP_TRANSITIONS, followUpAfterDecision } from './incident-classification.service';

describe('seguimiento de incidentes', () => {
  it('clasificar con seguimiento solo abre uno que no existía', () => {
    expect(followUpAfterDecision('none', true)).toBe('open');
    expect(followUpAfterDecision('closed', true)).toBe('closed');
    expect(followUpAfterDecision('open', false)).toBe('open');
    expect(followUpAfterDecision('none', false)).toBe('none');
  });

  it('cada acción exige el estado previo correcto', () => {
    expect(FOLLOW_UP_TRANSITIONS.note).toEqual({ from: 'open', to: 'open' });
    expect(FOLLOW_UP_TRANSITIONS.close).toEqual({ from: 'open', to: 'closed' });
    expect(FOLLOW_UP_TRANSITIONS.reopen).toEqual({ from: 'closed', to: 'open' });
  });
});
