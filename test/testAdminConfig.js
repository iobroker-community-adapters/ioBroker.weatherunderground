const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
const { WeatherSettings, initialSettings } = context.components;
const plain = value => JSON.parse(JSON.stringify(value));

describe('JSON configuration migration', () => {
    it('loads backend weather translations and removes the admin namespace from configuration labels', () => {
        const dictionary = require('../lib/words');
        assert.equal(dictionary.state_chancerain.en, 'Chance rain');
        assert.equal(dictionary.state_chancerain.de, 'Möglicher Regen');
        assert.equal(dictionary.current?.en, 'Current station measurements');
        assert.equal(dictionary.current?.de, 'Aktuelle Stationsmesswerte');
    });

    it('keeps the existing editable fields, values and hidden-field conditions', () => {
        const editable = Object.keys(config.items).filter(key => !key.startsWith('_'));
        assert.deepEqual(
            editable.sort(),
            [
                'apiKey',
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
                'regionalCurrent',
                'station',
            ].sort(),
        );
        assert.equal(config.items.apiKey.type, 'password');
        assert.equal(require('../io-package.json').native.regionalCurrent, false);
        assert.equal(config.items.regionalCurrent.type, 'checkbox');
        assert.equal(config.items.regionalCurrent.disabled, '!data.current');
        assert.equal(config.items.station.hidden, '!data.current');
        assert.ok(!('hidden' in config.items.custom_icon_base_url));
        assert.ok(!('hidden' in config.items.custom_icon_format));
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
            apiKey: 'synthetic-key',
        };
        const result = initialSettings(data, { latitude: 1, longitude: 2, tempUnit: '°F' });
        assert.deepEqual(plain(result), data);
        assert.deepEqual(plain(initialSettings(result, { tempUnit: '°F' })), data);
    });

    it('moves a legacy key into the encrypted field before the first adapter start without mutating the source', () => {
        const data = { apikey: 'synthetic-legacy-key', station: 'PWS' };
        const result = initialSettings(data, {});
        assert.equal(result.apiKey, data.apikey);
        assert.equal(result.apikey, '');
        assert.equal(result.station, 'PWS');
        assert.equal(data.apikey, 'synthetic-legacy-key');
        assert.deepEqual(plain(initialSettings(result, {})), plain(result));
    });

    it('preserves conflicting keys rather than silently discarding either value', () => {
        const result = initialSettings({ apikey: 'legacy', apiKey: 'new' }, {});
        assert.equal(result.apiKey, 'new');
        assert.equal(result.apikey, 'legacy');
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

    it('renders numeric preview images for stock sets and explicit custom formats', () => {
        const cases = [
            [
                {
                    iconSet: 'c',
                    useLegacyApi: true,
                    custom_icon_base_url: 'https://custom.example/',
                    custom_icon_format: 'gif',
                },
                'https://custom.example',
                'gif',
            ],
            [{ iconSet: 'i', useLegacyApi: false }, 'https://www.wunderground.com/static/i/c/v4', 'svg'],
            [{ iconSet: '' }, 'https://www.wunderground.com/static/i/c/v4', 'svg'],
            ...['gif', 'png', 'svg', 'jpg', undefined].map(format => [
                { iconSet: '', custom_icon_base_url: ' https://icons.example/// ', custom_icon_format: format },
                'https://icons.example',
                format || 'gif',
            ]),
        ];
        for (const [data, base, extension] of cases) {
            const component = new WeatherSettings();
            component.props = { schema: { custom: { mode: 'preview' } }, data };
            const images = component.render().children;
            assert.deepEqual(
                plain(images.map(image => ({ tag: image.tag, src: image.props.src, alt: image.props.alt }))),
                [0, 12, 26, 32].map(code => ({ tag: 'img', src: `${base}/${code}.${extension}`, alt: String(code) })),
            );
        }
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
