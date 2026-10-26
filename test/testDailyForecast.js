const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

function fetchDaily({ url = '', ownerKey = '' } = {}) {
    const requests = [];
    const weatherData = { current_observation: { lat: 51.4, lon: 6.7 } };
    return new Promise(resolve => {
        vm.runInNewContext(
            `${source}
            adapter = testAdapter;
            newWebKey = 'website-key';
            officialApiKey = testOwnerKey;
            lang = 'de-DE';
            forecastDailyUrl = testUrl;
            getNewWuDataDailyForecast(testData, testCallback);
        `,
            {
                require: name => {
                    if (name === '@iobroker/adapter-core') {
                        return {};
                    }
                    if (name === 'axios') {
                        return {
                            get: async requested => {
                                requests.push(requested);
                                return { data: { dayOfWeek: ['Monday'], temperatureMax: [8] } };
                            },
                        };
                    }
                    return adapterRequire(name);
                },
                module: { parent: true, exports: {} },
                testAdapter: {
                    config: { forecast_periods: true, station: 'TEST1' },
                    log: { debug() {}, info() {}, error() {} },
                },
                testOwnerKey: ownerKey,
                testUrl: url,
                testData: weatherData,
                testCallback: data => resolve({ data, requests }),
            },
        );
    });
}

describe('daily forecast requests', () => {
    for (const cachedUrl of ['', 'https://api.weather.com/v3/wx/forecast/daily/15day?geocode=0%2C0']) {
        it(`uses station coordinates and the website key with ${cachedUrl ? 'incorrect' : 'missing'} cached URL`, async () => {
            const { data, requests } = await fetchDaily({ url: cachedUrl });
            const requested = new URL(requests[0]);
            assert.equal(requested.pathname, '/v3/wx/forecast/daily/5day');
            assert.equal(requested.searchParams.get('geocode'), '51.4,6.7');
            assert.equal(requested.searchParams.get('apiKey'), 'website-key');
            assert.equal(requested.searchParams.get('units'), 'm');
            assert.equal(requested.searchParams.get('language'), 'de-DE');
            assert.equal(data.daily_forecast.temperatureMax[0], 8);
        });
    }

    it('prefers the owner key for direct daily requests', async () => {
        const { requests } = await fetchDaily({ ownerKey: 'owner-key' });
        assert.equal(new URL(requests[0]).searchParams.get('apiKey'), 'owner-key');
    });
});
