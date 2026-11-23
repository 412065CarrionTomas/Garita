import { faqEntries, faqForRole, groupFaqByTopic, searchFaq } from './faq';
import type { FaqEntry } from './faq';
import { USER_ROLES } from './roles';

const sample: FaqEntry[] = [
  {
    id: 'a',
    topic: 'Acceso',
    question: '¿Cómo ingreso?',
    answer: ['Con tu contraseña.'],
    audiences: ['public'],
  },
  {
    id: 'b',
    topic: 'Turnos',
    question: '¿Cómo creo un turno?',
    answer: ['Elegí **Crear turno**.'],
    audiences: ['admin', 'supervisor'],
  },
  {
    id: 'c',
    topic: 'Acceso',
    question: '¿Qué es el pánico?',
    answer: ['Un aviso urgente.'],
    audiences: ['guard'],
  },
];

describe('faqForRole', () => {
  it('sin sesión muestra solo lo público', () => {
    expect(faqForRole(null, sample).map((entry) => entry.id)).toEqual(['a']);
  });

  it('con sesión suma lo del rol y nada de otros roles', () => {
    expect(faqForRole('guard', sample).map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(faqForRole('client', sample).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('searchFaq', () => {
  it('ignora mayúsculas y tildes, y exige todas las palabras', () => {
    expect(searchFaq(sample, 'PANICO').map((entry) => entry.id)).toEqual(['c']);
    expect(searchFaq(sample, 'crear turno').map((entry) => entry.id)).toEqual(['b']);
    expect(searchFaq(sample, 'turno inexistente')).toEqual([]);
  });

  it('sin texto devuelve todo', () => {
    expect(searchFaq(sample, '  ')).toHaveLength(3);
  });
});

it('agrupa por tema en orden de aparición', () => {
  expect(groupFaqByTopic(sample).map((group) => [group.topic, group.entries.length])).toEqual([
    ['Acceso', 2],
    ['Turnos', 1],
  ]);
});

describe('contenido', () => {
  it('tiene ids únicos, audiencias válidas y respuestas sin referencias internas', () => {
    const audiences = new Set<string>(['public', ...USER_ROLES]);
    expect(new Set(faqEntries.map((entry) => entry.id)).size).toBe(faqEntries.length);
    for (const entry of faqEntries) {
      expect(entry.audiences.length).toBeGreaterThan(0);
      expect(entry.audiences.every((audience) => audiences.has(audience))).toBe(true);
      expect(entry.answer.length).toBeGreaterThan(0);
      expect([entry.question, ...entry.answer].join(' ')).not.toMatch(/HU-\d|\.tsx?\b|\/api\//);
    }
  });

  it.each(['public', ...USER_ROLES] as const)('tiene preguntas para %s', (audience) => {
    expect(faqEntries.some((entry) => entry.audiences.includes(audience))).toBe(true);
  });
});
