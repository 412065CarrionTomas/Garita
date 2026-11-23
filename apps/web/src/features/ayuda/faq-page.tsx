import { useId, useState } from 'react';
import { Link } from 'react-router';
import { faqForRole, groupFaqByTopic, LEGAL_OWNER, searchFaq } from '@garita/shared';
import type { UserRole } from '@garita/shared';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '../auth/auth-context';
import { LegalLinks } from '../legal/legal-pages';

/** `**Botón**` → negrita; el resto, texto plano (nunca HTML). */
function RichText({ text }: { text: string }) {
  return text
    .split('**')
    .map((part, index) =>
      index % 2 === 1 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>,
    );
}

function FaqList({ role }: { role: UserRole | null }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const entries = searchFaq(faqForRole(role), query);
  const groups = groupFaqByTopic(entries);
  return (
    <div className="space-y-6">
      <div className="max-w-md space-y-1.5">
        <Label htmlFor={id}>Buscar en las preguntas</Label>
        <Input
          id={id}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Ej.: contraseña, turno, pánico"
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {entries.length === 1 ? '1 pregunta' : `${String(entries.length)} preguntas`}
      </p>
      {groups.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          description="Probá con otra palabra o borrá la búsqueda."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('');
              }}
            >
              Borrar búsqueda
            </Button>
          }
        />
      ) : (
        groups.map((group, index) => (
          <section
            key={group.topic}
            aria-labelledby={`${id}-${String(index)}`}
            className="space-y-2"
          >
            <h2 id={`${id}-${String(index)}`} className="t-label text-muted-foreground">
              {group.topic}
            </h2>
            <div className="divide-y rounded-lg border bg-card">
              {group.entries.map((entry) => (
                <details key={entry.id} className="group px-4 py-3">
                  <summary className="cursor-pointer list-none font-semibold text-foreground marker:hidden [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <span aria-hidden="true" className="mr-2 inline-block group-open:rotate-90">
                      ›
                    </span>
                    <span>{entry.question}</span>
                  </summary>
                  <div className="mt-2 space-y-2 pl-5 text-sm leading-relaxed">
                    {entry.answer.map((paragraph) => (
                      <p key={paragraph}>
                        <RichText text={paragraph} />
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))
      )}
      <p className="text-sm text-muted-foreground">
        ¿No encontraste lo que buscabas? Escribinos a{' '}
        <a className="underline" href={`mailto:${LEGAL_OWNER.email}`}>
          {LEGAL_OWNER.email}
        </a>
        .
      </p>
    </div>
  );
}

/** Dentro del panel: lo público y lo del rol del usuario. */
export function FaqPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Preguntas frecuentes"
        description="Respuestas rápidas sobre el uso de Garita."
      />
      <FaqList role={user?.role ?? null} />
    </div>
  );
}

/** Sin sesión: solo la información general, para quien no puede ingresar. */
export function PublicFaqPage() {
  return (
    <main className="min-h-svh bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8" />
          <span className="font-cond text-xl font-semibold uppercase tracking-wider">Garita</span>
        </div>
        <PageHeader
          title="Preguntas frecuentes"
          description="Ayuda para ingresar y conocer Garita. Al iniciar sesión vas a ver las preguntas de tu rol."
          actions={
            <Button asChild>
              <Link to="/ingresar">Iniciar sesión</Link>
            </Button>
          }
        />
        <FaqList role={null} />
        <LegalLinks />
      </div>
    </main>
  );
}
