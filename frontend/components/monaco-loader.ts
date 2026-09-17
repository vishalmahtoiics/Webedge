import { loader } from '@monaco-editor/react';

/**
 * Serve Monaco from this origin rather than a CDN.
 *
 * @monaco-editor/react defaults to loading the editor from jsdelivr at runtime.
 * That is wrong here for two reasons: it breaks entirely on a restricted
 * network, and it means a third party can deliver executable code to the page
 * where customers edit their server files. The `vs` folder is copied from
 * node_modules by the `monaco:copy` script, so the served version always matches
 * package.json.
 */
loader.config({ paths: { vs: '/monaco/vs' } });
