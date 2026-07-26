import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import tseslint from 'typescript-eslint';

const RENDERER = './src/renderer/src';

// Node builtins have no business in the renderer or in src/shared/, which both
// processes import. Preload is the only sanctioned way across the boundary.
const NODE_ONLY_IMPORTS = [
  { group: ['node:*'], message: 'Node APIs never appear here. Go through the preload bridge.' },
  {
    group: ['electron', 'fs', 'path', 'os', 'crypto', 'child_process', 'worker_threads'],
    message: 'Node APIs never appear here. Go through the preload bridge.',
  },
];

/**
 * `target` is where the importing file lives, `from` is what it may not reach.
 * Zones cover the four renderer boundary rules in AGENTS.md plus the
 * main/renderer process split, because convention does not survive contact with
 * agent-written code — only a lint failure does.
 */
const BOUNDARY_ZONES = [
  // 1. Pages never import from other pages. One zone per screen, so a screen's
  //    own page-focused components stay reachable.
  {
    target: `${RENDERER}/screens/Workspace`,
    from: `${RENDERER}/screens`,
    except: ['./Workspace'],
    message: 'Pages never import from other pages. Promote the component into modules/ instead.',
  },
  {
    target: `${RENDERER}/screens/Settings`,
    from: `${RENDERER}/screens`,
    except: ['./Settings'],
    message: 'Pages never import from other pages. Promote the component into modules/ instead.',
  },
  // 2. The direction is strictly downward: screens → modules → shared floor.
  ...['modules', 'components', 'hooks', 'stores', 'lib'].map((layer) => ({
    target: `${RENDERER}/${layer}`,
    from: `${RENDERER}/screens`,
    message: 'Nothing below screens/ may import a screen. Pass it down as a prop or shared state.',
  })),
  // 3. The shared floor stays a set of proven primitives, not a module consumer.
  ...['components', 'hooks', 'stores', 'lib'].map((layer) => ({
    target: `${RENDERER}/${layer}`,
    from: `${RENDERER}/modules`,
    message: 'The shared floor may not import the module layer. Only the reverse direction.',
  })),
  // 4. Process boundaries: src/shared/ is the only code both processes import.
  {
    target: './src/renderer',
    from: './src/main',
    message: 'The renderer never imports main. All traffic goes through src/main/ipc.ts.',
  },
  {
    target: './src/main',
    from: './src/renderer',
    message: 'Main never imports the renderer. Shared types belong in src/shared/.',
  },
  ...['./src/main', './src/renderer', './src/preload'].map((from) => ({
    target: './src/shared',
    from,
    message: 'src/shared/ is imported by both processes, so it must stay dependency-free.',
  })),
];

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', 'coverage/**', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    plugins: { 'import-x': importX },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    settings: {
      // Without the parser mapping, import-x cannot parse an imported .ts file,
      // so its graph traversal stops and no-cycle silently finds nothing.
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.cts', '.mts'] },
      'import-x/extensions': ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
      'import-x/resolver-next': [
        // Two projects because main/preload and renderer have separate tsconfigs;
        // the multiple-projects warning is expected, not a misconfiguration.
        createTypeScriptImportResolver({
          project: ['tsconfig.node.json', 'tsconfig.web.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      // Typed consts over enums; RUN_STATE is the canonical example.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use an `as const` object instead of an enum. See RUN_STATE.',
        },
      ],
      // z.infer output is a `type` alias and stays exempt: this rule only flags
      // hand-written object literal shapes, which are what must be interfaces.
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import-x/no-restricted-paths': [
        'error',
        { basePath: import.meta.dirname, zones: BOUNDARY_ZONES },
      ],
    },
  },
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    // configs.recommended is still eslintrc-shaped; configs.flat is the flat one.
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: NODE_ONLY_IMPORTS }],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: NODE_ONLY_IMPORTS }],
    },
  },
  {
    // A cycle between two modules welds them into one undeletable blob, which is
    // the one guard on the module layer's freedom to compose freely.
    files: ['src/renderer/src/modules/**/*.{ts,tsx}'],
    rules: {
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
    },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      '*.config.{ts,mts,mjs}',
      // Build-time scripts run on Node too; the icon generator is one.
      'build/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);
