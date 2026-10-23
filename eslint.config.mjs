import config from '@iobroker/eslint-config';

export default [
    ...config,
    { ignores: ['.vscode/', 'goals/', 'admin/custom/'] },
    { files: ['test/**/*.js'], languageOptions: { globals: { describe: 'readonly', it: 'readonly' } } },
];
