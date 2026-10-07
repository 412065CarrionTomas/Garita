import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <ShieldCheck className="size-12 text-primary" aria-hidden="true" />
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Garita</h1>
        <p className="text-muted-foreground">
          Control de rondas para empresas de seguridad privada.
        </p>
      </div>
      <Button>Ingresar</Button>
    </main>
  );
}
