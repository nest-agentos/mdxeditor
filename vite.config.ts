import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    base: './',
    build: {
        lib: { entry: resolve(__dirname, 'src/index.ts'), name: 'MDxEditor', formats: ['es', 'umd'],
            fileName: format => format === 'es' ? 'mdxeditor.js' : 'mdxeditor.umd.cjs' },
        cssCodeSplit: false,
        sourcemap: true,
        rollupOptions: {
            external: ['parse5', 'quickjs-emscripten-core', '@jitl/quickjs-singlefile-browser-release-sync', '@nestos/ui-common', /^@codemirror\//, 'codemirror', 'marked', 'mermaid', 'front-matter', 'gray-matter'],
            output: { globals: {parse5: 'parse5', '@nestos/ui-common': 'ItookitUICommon', '@codemirror/language-data': 'CM.languageData', codemirror: 'CodeMirror', marked: 'marked', mermaid: 'mermaid',
                'front-matter': 'fm', 'gray-matter': 'gm',
                '@codemirror/state': 'CM.state', '@codemirror/view': 'CM.view', '@codemirror/commands': 'CM.commands',
                '@codemirror/language': 'CM.language', '@codemirror/autocomplete': 'CM.autocomplete',
                '@codemirror/lint': 'CM.lint', '@codemirror/search': 'CM.search', '@codemirror/lang-markdown': 'CM.langMarkdown' },
                assetFileNames: asset => asset.name?.endsWith('.css') ? 'style.css' : asset.name ?? 'asset' },
        },
    },

});
