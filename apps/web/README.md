# Panel web de Garita

Panel para los roles **administrador**, **supervisor** y **cliente**. Es una PWA instalable hecha con React, TypeScript y [Vite](https://vite.dev).

## Stack

- [Tailwind CSS](https://tailwindcss.com) y [shadcn/ui](https://ui.shadcn.com) para la interfaz.
- [TanStack Query](https://tanstack.com/query) para el estado del servidor.
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app) para el service worker y el manifiesto. Los íconos se generan desde `public/logo.svg` en cada build.
- Jest y React Testing Library para los tests.

## Desarrollo

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter web dev        # http://localhost:5173
pnpm --filter web test
```

Para agregar componentes de shadcn/ui:

```bash
pnpm --filter web exec shadcn add <componente>
```

## Variables de entorno

| Variable       | Descripción                                                                |
| -------------- | -------------------------------------------------------------------------- |
| `VITE_API_URL` | URL base de la API, con prefijo y versión (`http://localhost:3000/api/v1`) |

Las variables `VITE_*` se incrustan en el build y son públicas: nunca deben contener secretos.
