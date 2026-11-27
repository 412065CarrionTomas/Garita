# Garita

[![CI](https://github.com/412065CarrionTomas/Garita/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/412065CarrionTomas/Garita/actions/workflows/ci.yml)

Sistema de control de rondas para empresas de seguridad privada. Trabajo Final Integrador de la Tecnicatura Universitaria en Programación (UTN FRC).

## El producto

Garita permite a una empresa de seguridad planificar los recorridos de sus vigiladores, comprobar que se cumplen y enterarse de inmediato cuando algo falla. Reemplaza las planillas de papel y los controles manuales por registros con hora y ubicación confiables, aun en predios donde no hay señal de datos.

Cada empresa trabaja de forma aislada: sus clientes, predios, turnos y usuarios no son visibles para otras empresas.

### Quién lo usa

| Rol               | Dónde trabaja | Qué hace                                                                                           |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| **Administrador** | Panel web     | Da de alta clientes, predios, puntos de control, rondas, turnos y usuarios.                        |
| **Supervisor**    | Panel web     | Sigue los turnos en vivo, revisa las rondas incumplidas y clasifica los incidentes de sus predios. |
| **Cliente**       | Panel web     | Accede a la información de sus propios predios.                                                    |
| **Vigilador**     | App móvil     | Ejecuta su turno, recorre los puntos de control y reporta incidentes.                              |

### Qué ofrece

- **Rondas y turnos:** cada ronda define sus puntos de control, frecuencia, franja horaria y tiempo de gracia. Los turnos se asignan a un vigilador y se dividen en ventanas de cumplimiento.
- **Registro de puntos por QR o NFC:** el vigilador marca cada punto de control con la cámara o acercando el celular a una etiqueta NFC.
- **Funcionamiento sin señal:** la app guarda todo en el dispositivo y sincroniza cuando recupera la conexión. Cada predio configura su tiempo de traslado hasta una zona con señal, para distinguir un vigilador sin cobertura de uno que no cumplió.
- **Hora y ubicación confiables:** los registros combinan la hora del dispositivo con la del servidor para detectar relojes alterados.
- **Supervisión en vivo:** estado de cada turno, ventanas cumplidas, tardías o pendientes, y estado de sincronización de cada vigilador.
- **Botón de pánico:** alerta de emergencia con canales de respaldo cuando no hay datos.
- **Incidentes con fotos:** el vigilador reporta novedades con descripción y fotografías, y el supervisor las clasifica como internas o visibles para el cliente.
- **Notificaciones push** al panel web y a la app.

## Estructura

| Paquete                                                    | Descripción                                          |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| [`apps/api`](apps/api)                                     | API con NestJS, Prisma (PostgreSQL) y BullMQ (Redis) |
| [`apps/web`](apps/web)                                     | Panel web con React, Vite, Tailwind CSS y shadcn/ui  |
| [`apps/mobile`](apps/mobile)                               | App del vigilador con Expo y Expo Router             |
| [`packages/shared`](packages/shared)                       | Tipos y esquemas Zod compartidos                     |
| [`packages/tokens`](packages/tokens)                       | Tokens de diseño (color, espaciado, tipografía)      |
| [`packages/typescript-config`](packages/typescript-config) | Configuración base de TypeScript                     |
| [`packages/eslint-config`](packages/eslint-config)         | Configuración de ESLint                              |

## Documentación

- [Guía de contribución](CONTRIBUTING.md): ramas, commits y pull requests.
- [Guía para agentes de IA](AGENTS.md): stack y convenciones de código.
- [Servicios externos](docs/servicios-externos.md): cuentas y credenciales.
- [Despliegue de staging](docs/despliegue.md): Render, Vercel, Neon y EAS.

## Licencia

Software propietario. © 2026 Tomás Carrión. Todos los derechos reservados. El código se publica solo para lectura; no está permitido copiarlo, modificarlo, distribuirlo ni usarlo sin autorización escrita. Ver [LICENSE](LICENSE).
