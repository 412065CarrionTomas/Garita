/**
 * Valida los mensajes de commit con Conventional Commits (descripción en español).
 * Además rechaza coautores y firmas automáticas de herramientas (ver CONTRIBUTING.md).
 */
const FORBIDDEN_TRAILERS = /^(co-authored-by:|generated with\b)/im;

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-co-authors': ({ raw }) => [
          !FORBIDDEN_TRAILERS.test(raw ?? ''),
          'el commit no debe incluir coautores ni firmas automáticas de herramientas',
        ],
      },
    },
  ],
  rules: {
    'no-co-authors': [2, 'always'],
    'scope-enum': [2, 'always', ['api', 'web', 'mobile', 'shared', 'db', 'ci', 'deps', 'repo']],
  },
};
