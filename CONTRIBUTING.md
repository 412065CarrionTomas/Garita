# Guía de contribución

Reglas de trabajo con Git para el repositorio de Garita. Las convenciones de código están en [AGENTS.md](AGENTS.md).

## Ramas (Git Flow)

| Rama | Sale de | Se mergea en | Uso |
|---|---|---|---|
| `main` | — | — | Código en producción |
| `develop` | `main` | — | Integración de lo próximo a publicar |
| `feature/<descripcion>` | `develop` | `develop` | Funcionalidad nueva |
| `fix/<descripcion>` | `develop` | `develop` | Corrección de bug no urgente |
| `release/<version>` | `develop` | `main` y `develop` | Preparar una versión para producción |
| `hotfix/<descripcion>` | `main` | `main` y `develop` | Corrección urgente en producción |

- Nunca se commitea directo en `main` ni en `develop`: todo entra por pull request.
- Nombres en minúscula y con guiones: `feature/lectura-nfc`, `fix/sync-offline`, `release/1.2.0`.
- Las ramas `feature/*` y `fix/*` se integran con merge commit (`--no-ff`) para conservar la historia de cada tarea.
- Al cerrar un `release/*` o `hotfix/*` en `main` se crea el tag `vX.Y.Z` siguiendo [SemVer](https://semver.org/lang/es/).

### Flujo de una tarea

```bash
git switch develop
git pull
git switch -c feature/<descripcion>
# ... commits atómicos ...
git push -u origin feature/<descripcion>
# abrir un pull request hacia develop
```

## Commits

Se usa [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) con la descripción en español.

```
<tipo>(<alcance>): <descripción en imperativo y minúscula>

[cuerpo opcional: qué y por qué]

Refs: SCRUM-<n>
```

- **Tipos:** `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `chore`, `perf`, `ci`, `build`.
- **Alcances:** `api`, `web`, `mobile`, `shared`, `db`, `ci`, `deps`, `repo`.
- El pie `Refs: SCRUM-<n>` vincula el commit con la tarea de Jira.
- Un commit = un cambio lógico, y cada commit deja el proyecto compilando.
- No se agregan coautores (`Co-authored-by:`) ni firmas automáticas de herramientas.
- Nunca se commitean archivos `.env`, credenciales, builds ni `node_modules`.

## Pull requests

- Título con el mismo formato que un commit.
- Completar la plantilla: tarea de Jira, qué cambia y cómo se probó.
- El pipeline de CI (lint, typecheck, test y build) debe pasar antes de mergear.
