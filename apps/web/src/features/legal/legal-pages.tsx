import { Link } from 'react-router';
import { LEGAL_OWNER, privacyPolicy, termsOfService } from '@garita/shared';
import type { LegalDocument } from '@garita/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function LegalDocumentPage({ document, other }: { document: LegalDocument; other: ReactLink }) {
  return (
    <main className="min-h-svh bg-background px-4 py-8 text-foreground sm:px-6">
      <article className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8" />
          <span className="font-cond text-xl font-semibold uppercase tracking-wider">Garita</span>
        </div>
        <header className="space-y-2">
          <h1 className="t-headline">{document.title}</h1>
          <p className="text-sm text-muted-foreground">
            Última actualización: {formatDate(document.updatedAt)}
          </p>
          <p>{document.intro}</p>
        </header>
        {document.sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <footer className="space-y-1 border-t pt-4 text-sm text-muted-foreground">
          <p>Contacto: {LEGAL_OWNER.email}</p>
          <p>
            Ver también: <Link to={other.to}>{other.label}</Link>
          </p>
        </footer>
      </article>
    </main>
  );
}

interface ReactLink {
  to: string;
  label: string;
}

export function TermsPage() {
  return (
    <LegalDocumentPage
      document={termsOfService}
      other={{ to: '/privacidad', label: privacyPolicy.title }}
    />
  );
}

export function PrivacyPage() {
  return (
    <LegalDocumentPage
      document={privacyPolicy}
      other={{ to: '/terminos', label: termsOfService.title }}
    />
  );
}

/** Casilla de aceptación explícita. Los enlaces abren en otra pestaña para no perder el flujo. */
export function LegalConsent({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id="legal-consent"
        checked={checked}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
        className="mt-0.5"
      />
      <Label htmlFor="legal-consent" className="block font-normal leading-snug">
        Leí y acepto los{' '}
        <a href="/terminos" target="_blank" rel="noreferrer" className="underline">
          Términos y Condiciones
        </a>{' '}
        y la{' '}
        <a href="/privacidad" target="_blank" rel="noreferrer" className="underline">
          Política de Privacidad
        </a>
        .
      </Label>
    </div>
  );
}

/** Enlaces para pies de página. */
export function LegalLinks() {
  return (
    <nav aria-label="Legales" className="flex justify-center gap-4 text-xs text-muted-foreground">
      <Link to="/terminos" className="underline">
        Términos y Condiciones
      </Link>
      <Link to="/privacidad" className="underline">
        Política de Privacidad
      </Link>
    </nav>
  );
}
