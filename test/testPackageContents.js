const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

describe('published package', function () {
    this.timeout(30000);

    it('ships runtime and admin assets while excluding development files', () => {
        const root = path.join(__dirname, '..');
        const development = fs.mkdtempSync(path.join(root, 'package-check-development-'));
        try {
            fs.writeFileSync(path.join(development, 'must-not-ship.js'), 'development only');
            const [pack] = JSON.parse(
                execSync('npm pack --dry-run --json --ignore-scripts', {
                    cwd: root,
                    encoding: 'utf8',
                }),
            );
            const files = pack.files.map(file => file.path);
            for (const required of [
                'main.js',
                'lib/words.js',
                'io-package.json',
                'package.json',
                'README.md',
                'LICENSE',
                'admin/wu.png',
                'admin/jsonConfig.json',
                'admin/custom/remoteEntry.js',
            ]) {
                assert.ok(files.includes(required), `${required} must ship`);
            }
            for (const language of ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn']) {
                assert.ok(files.includes(`admin/i18n/${language}.json`), `${language} translations must ship`);
            }
            for (const file of files) {
                assert.ok(
                    !/^(test\/|goals\/|\.github\/|\.vscode\/|package-check-development-|CHANGELOG_OLD\.md$|tsconfig|eslint\.|prettier\.)/.test(
                        file,
                    ),
                    `${file} must not ship`,
                );
            }
        } finally {
            fs.rmSync(development, { recursive: true, force: true });
        }
    });
});
