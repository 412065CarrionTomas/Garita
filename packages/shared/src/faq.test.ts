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

  it('con sesión pone primero lo del rol, suma lo público y nada de otros roles', () => {
    expect(faqForRole('guard', sample).map((entry) => entry.id)).toEqual(['c', 'a']);
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
      // Un `**` sin cerrar dejaría en negrita el resto del párrafo.
      for (const paragraph of entry.answer)
        expect((paragraph.match(/\*\*/g)?.length ?? 0) % 2).toBe(0);
    }
  });

  it('sigue las pautas: preguntas únicas, respuestas breves y enlaces internos', () => {
    expect(new Set(faqEntries.map((entry) => entry.question)).size).toBe(faqEntries.length);
    for (const entry of faqEntries) {
      expect(entry.question).toMatch(/^¿.+\?$/);
      expect(entry.answer.length).toBeLessThanOrEqual(4);
      if (entry.link) expect(entry.link.path).toMatch(/^\/[^/]/);
    }
  });

  it('lo público no repite roles: se muestra igual con o sin sesión', () => {
    for (const entry of faqEntries.filter((item) => item.audiences.includes('public')))
      expect(entry.audiences).toEqual(['public']);
  });

  it.each(['public', ...USER_ROLES] as const)('tiene preguntas para %s', (audience) => {
    expect(faqEntries.some((entry) => entry.audiences.includes(audience))).toBe(true);
  });
});
