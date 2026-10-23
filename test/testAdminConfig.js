const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const admin = path.join(__dirname, '../admin');
const config = require('../admin/jsonConfig.json');
const source = fs.readFileSync(path.join(admin, 'src/WeatherSettings.js'), 'utf8');
const context = { React: { Component: class {}, createElement: (tag, props, children) => ({ tag, props, children }) } };
vm.runInNewContext(
    source
        .replace("import React from 'react';", '')
        .replaceAll('export function ', 'function ')
        .replace(
            'export default { WeatherSettings };',
            'this.components = { WeatherSettings, initialSettings, previewUrls };',
        ),
    context,
);
const { WeatherSettings, initialSettings, previewUrls } = context.components;
const plain = value => JSON.parse(JSON.stringify(value));

describe('JSON configuration migration', () => {
    it('preserves every translated key and value in the backend dictionary', () => {
        const dictionary = require('../lib/words');
        const sorted = Object.fromEntries(
            Object.entries(dictionary)
                .sort()
                .map(([key, translations]) => [key, Object.fromEntries(Object.entries(translations).sort())]),
        );
        assert.equal(
            crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),
            '470c1fd12286fd5841e44aa5f0671b20ae259aeac544a343dd346e770ea8a1da',
        );
        assert.equal(dictionary.state_chancerain.en, 'Chance rain');
        assert.ok(dictionary.state_chancerain.de);
    });

    it('keeps the existing editable fields, values and hidden-field conditions', () => {
        const editable = Object.keys(config.items).filter(key => !key.startsWith('_'));
        assert.deepEqual(
            editable.sort(),
            [
                'apikey',
                'country',
                'current',
                'custom_icon_base_url',
                'custom_icon_format',
                'forecast_hourly',
                'forecast_periods',
                'forecast_periods_txt',
                'iconSet',
                'language',
                'location',
                'nonMetric',
                'station',
            ].sort(),
        );
        assert.equal(config.items.apikey.type, 'password');
        assert.equal(config.items.station.hidden, '!data.current');
        assert.equal(config.items.custom_icon_base_url.hidden, '!!data.iconSet');
        assert.equal(config.items.custom_icon_format.hidden, '!!data.iconSet');
        assert.deepEqual(
            config.items.iconSet.options.map(option => option.value),
            [...'abcdefghijk', ''],
        );
        assert.ok(!('default' in config.items.iconSet));
        assert.deepEqual(
            config.items.language.options.map(option => option.value),
            ['DL', 'EN', 'RU', 'NL'],
        );
    });

    it('initializes blank locations including zero coordinates and Fahrenheit', () => {
        for (const latitude of [0, 50]) {
            for (const longitude of [0, 8]) {
                const input = { location: '', nonMetric: false };
                const result = initialSettings(input, { latitude, longitude, tempUnit: '°F' });
                assert.equal(result.location, `${latitude},${longitude}`);
                assert.equal(result.nonMetric, true);
                assert.deepEqual(input, { location: '', nonMetric: false });
            }
        }
        assert.equal(initialSettings({ location: '' }, { latitude: '', longitude: 0 }).location, '');
        assert.equal(initialSettings({ location: '' }, { latitude: 'invalid', longitude: 0 }).location, '');
    });

    it('preserves saved settings and hidden values, including custom icons and metric units', () => {
        const data = {
            location: 'Berlin',
            nonMetric: false,
            iconSet: '',
            country: 'NL',
            useLegacyApi: false,
            current: false,
            station: 'PWS',
            custom_icon_base_url: 'https://icons.example/',
            custom_icon_format: 'svg',
            apikey: 'synthetic-key',
        };
        const result = initialSettings(data, { latitude: 1, longitude: 2, tempUnit: '°F' });
        assert.deepEqual(plain(result), data);
        assert.deepEqual(plain(initialSettings(result, { tempUnit: '°F' })), data);
    });

    it('keeps legacy defaults for absent fields without resetting explicit false or custom icon values', () => {
        assert.deepEqual(plain(initialSettings({}, {})), {
            iconSet: 'i',
            nonMetric: false,
            country: 'DE',
            useLegacyApi: true,
        });
        assert.equal(initialSettings({ iconSet: undefined }, {}).iconSet, 'i');
        assert.equal(initialSettings({ iconSet: '' }, {}).iconSet, '');
        assert.equal(initialSettings({ location: '', nonMetric: true }, { tempUnit: '°C' }).nonMetric, true);
    });

    it('previews every stock set and every custom image format with the runtime gif fallback', () => {
        for (const iconSet of 'abcdefghijk') {
            const urls = previewUrls({ iconSet });
            assert.equal(urls.length, 19);
            assert.equal(urls[0].src, `https://www.wunderground.com/static/i/c/${iconSet}/chanceflurries.gif`);
        }
        for (const extension of ['gif', 'png', 'svg', 'jpg', undefined]) {
            for (const base of ['https://icons.example', 'https://icons.example/']) {
                const urls = previewUrls({ iconSet: '', custom_icon_base_url: base, custom_icon_format: extension });
                assert.equal(urls[0].src, `https://icons.example/chanceflurries.${extension || 'gif'}`);
            }
        }
        assert.deepEqual(plain(previewUrls({ iconSet: '' })), []);
    });

    it('passes initial defaults through the official onChange and forceUpdate callbacks', () => {
        const component = new WeatherSettings();
        let changed = { location: '', nonMetric: false };
        let updated = { keys: Object.keys(changed), data: changed };
        component.props = {
            schema: { custom: { mode: 'defaults' } },
            data: { location: '', nonMetric: false },
            systemConfig: { latitude: 0, longitude: 0, tempUnit: '°F' },
            onChange: (data, _value, callback) => {
                changed = data;
                callback();
            },
            forceUpdate: (keys, data) => {
                updated = { keys, data };
            },
        };
        component.componentDidMount();
        assert.ok(changed);
        assert.ok(updated);
        assert.equal(changed.location, '0,0');
        assert.equal(changed.nonMetric, true);
        assert.equal(updated.data, changed);
        assert.ok(updated.keys.includes('nonMetric'));
        assert.equal(component.render(), null);
    });
});
