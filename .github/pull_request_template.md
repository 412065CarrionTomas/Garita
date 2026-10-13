## Tarea de Jira

HU<id>-<name>
ID-<subtask-name>

## Resumen

<!-- Resumen de los cambios y por qué se hacen. -->

## Criterios de aceptación

| CRITERIO                                                             | VERIFICADO                                   |
| -------------------------------------------------------------------- | -------------------------------------------- |
| <!-- Criterio, con su referencia (por ejemplo, HU-12 criterio 1) --> | <!-- Cómo se verificó, en pocas palabras --> |

## Cómo se probó

<!-- Tests agregados, pasos manuales, capturas si aplica. -->

## Checklist

- [ ] El pipeline de CI pasa (formato, lint, typecheck, test y build)
- [ ] La documentación afectada está actualizada
- [ ] Si hay variables de entorno nuevas, están en el `.env.example` correspondiente
- [ ] Si hay cambios de esquema, tienen su migración de Prisma
- [ ] Si hay cambios en archivos protegidos, la revisión la aprueba el dueño del repositorio
- [ ] No se incluyen secretos, `.env` ni archivos generados
- [ ] Los commits siguen Conventional Commits con descripción en español, sin coautores
