const assert = require('node:assert/strict');
const resolveIconUrl = require('../lib/icon-url');

describe('provider icon URLs', () => {
    it('keeps numeric codes in v4 for every legacy set, including zero', () => {
        for (const iconSet of 'abcdefghijk') {
            for (const code of [0, '0', 32, '32']) {
                assert.equal(
                    resolveIconUrl(code, { iconSet, custom_icon_base_url: 'https://ignored.example/' }),
                    `https://www.wunderground.com/static/i/c/v4/${code}.svg`,
                );
            }
        }
    });

    it('preserves legacy day/night filenames and missing values', () => {
        for (const name of ['clear', 'nt_clear', 'chanceflurries']) {
            assert.equal(
                resolveIconUrl(`https://icons.wxug.com/i/c/k/${name}.gif`, { iconSet: 'c' }),
                `https://www.wunderground.com/static/i/c/c/${name}.gif`,
            );
        }
        for (const missing of [undefined, null, '']) {
            assert.equal(resolveIconUrl(missing, { iconSet: 'c' }), missing);
        }
    });

    it('normalizes explicit custom sets while preserving filename families and format defaults', () => {
        for (const base of [
            'https://icons.example/weather',
            'https://icons.example/weather/',
            ' https://icons.example/weather/// ',
        ]) {
            for (const format of ['gif', 'png', 'svg', undefined, '']) {
                const config = { iconSet: '', custom_icon_base_url: base, custom_icon_format: format };
                assert.equal(resolveIconUrl(32, config), `https://icons.example/weather/32.${format || 'gif'}`);
                assert.equal(
                    resolveIconUrl('https://icons.wxug.com/i/c/k/nt_clear.gif', config),
                    `https://icons.example/weather/nt_clear.${format || 'gif'}`,
                );
            }
        }
    });

    it('retains provider URLs without a usable custom base', () => {
        for (const base of [undefined, '', '   ']) {
            const config = { iconSet: '', custom_icon_base_url: base };
            assert.equal(resolveIconUrl(0, config), 'https://www.wunderground.com/static/i/c/v4/0.svg');
            const legacy = 'https://icons.wxug.com/i/c/k/clear.gif';
            assert.equal(resolveIconUrl(legacy, config), legacy);
        }
    });
});
