# Garita

[![CI](https://github.com/412065CarrionTomas/Garita/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/412065CarrionTomas/Garita/actions/workflows/ci.yml)

Sistema de control de rondas para empresas de seguridad privada. Trabajo Final Integrador de la Tecnicatura Universitaria en Programación (UTN FRC).

- **App móvil** para vigiladores (Android e iOS): registro de puntos de control por QR o NFC, funcionamiento sin señal y botón de pánico.
- **Panel web** (PWA) para administradores, supervisores y clientes.
- **API** central con REST y WebSockets.

## Estructura

| Paquete                                                    | Descripción                                          |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| [`apps/api`](apps/api)                                     | API con NestJS, Prisma (PostgreSQL) y BullMQ (Redis) |
| [`apps/web`](apps/web)                                     | Panel web con React, Vite, Tailwind CSS y shadcn/ui  |
| [`apps/mobile`](apps/mobile)                               | App del vigilador con Expo y Expo Router             |
| [`packages/shared`](packages/shared)                       | Tipos y esquemas Zod compartidos                     |
| [`packages/typescript-config`](packages/typescript-config) | Configuración base de TypeScript                     |
| [`packages/eslint-config`](packages/eslint-config)         | Configuración de ESLint                              |

## Requisitos

- Node.js 24 (ver `.nvmrc`)
- pnpm 12 (`npm install -g pnpm@12` o `corepack enable`)
- Docker, para PostgreSQL y Redis en desarrollo

## Puesta en marcha

```bash
pnpm install
docker compose up -d                         # PostgreSQL y Redis
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm dev                                     # API, panel web y Metro
```

## Scripts

| Script           | Descripción                               |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Levanta todas las apps en modo desarrollo |
| `pnpm build`     | Compila todos los paquetes                |
| `pnpm lint`      | ESLint en todo el monorepo                |
| `pnpm typecheck` | Chequeo de tipos                          |
| `pnpm test`      | Tests unitarios                           |
| `pnpm format`    | Formatea con Prettier                     |

## Documentación

- [Guía de contribución](CONTRIBUTING.md): ramas, commits y pull requests.
- [Guía para agentes de IA](AGENTS.md): stack y convenciones de código.
- [Servicios externos](docs/servicios-externos.md): cuentas y credenciales.
- [Despliegue de staging](docs/despliegue.md): Render, Vercel, Neon y EAS.
