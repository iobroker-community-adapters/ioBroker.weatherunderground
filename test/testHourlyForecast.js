const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

/**
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 * @param {string} [options.station]
 * @param {{lat: number, lon: number}} [options.observation]
 * @param {string} [options.url]
 * @param {boolean} [options.nonMetric]
 * @param {unknown} [options.error]
 */
function fetchHourly({ enabled = true, station = '', observation, url = '', nonMetric = false, error } = {}) {
    const requests = [];
    const weatherData = observation ? { current_observation: observation } : {};
    return new Promise((resolve) => {
        vm.runInNewContext(
            source +
                `
            adapter = testAdapter;
            newWebKey = 'website-key';
            officialApiKey = 'owner-key';
            lang = 'de-DE';
            nonMetric = testNonMetric;
            forecastHourlyUrl = testUrl;
            getNewWuDataHourlyForecast(testData, testCallback);
        `,
            {
                require: (name) => {
                    if (name === '@iobroker/adapter-core') return {};
                    if (name === 'axios')
                        return {
                            get: async (requested) => {
                                requests.push(requested);
                                if (error) throw error;
                                return { data: { temperature: [8] } };
                            },
                        };
                    return adapterRequire(name);
                },
                module: { parent: true, exports: {} },
                testAdapter: {
                    config: { forecast_hourly: enabled, station },
                    log: { debug() {}, error() {} },
                },
                testNonMetric: nonMetric,
                testUrl: url,
                testData: weatherData,
                testCallback: (data) => resolve({ data, requests }),
            },
        );
    });
}

describe('hourly forecasts', () => {
    for (const cachedUrl of ['', 'https://api.weather.com/v3/wx/forecast/hourly/15day?geocode=0%2C0']) {
        it(`uses station coordinates and the website key with ${cachedUrl ? 'incorrect' : 'missing'} cached URL`, async () => {
            const observation = { lat: 51.4, lon: 6.7 };
            const { data, requests } = await fetchHourly({ station: 'TEST1', observation, url: cachedUrl });
            const requested = new URL(requests[0]);
            assert.equal(requested.pathname, '/v3/wx/forecast/hourly/2day');
            assert.equal(requested.searchParams.get('geocode'), '51.4,6.7');
            assert.equal(requested.searchParams.get('apiKey'), 'website-key');
            assert.equal(requested.searchParams.get('units'), 'm');
            assert.equal(requested.searchParams.get('language'), 'de-DE');
            assert.equal(data.current_observation, observation);
            assert.equal(data.hourly_forecast.temperature[0], 8);
        });
    }

    for (const duration of ['48hour', '15day', '2day']) {
        it(`normalizes scraped ${duration} URLs without station observations`, async () => {
            const { requests } = await fetchHourly({
                url: `https://api.weather.com/v3/wx/forecast/hourly/${duration}?geocode=51.4%2C6.7&apiKey=website-key&units=e&language=en-US`,
            });
            const requested = new URL(requests[0]);
            assert.equal(requested.pathname, '/v3/wx/forecast/hourly/2day');
            assert.equal(requested.searchParams.get('geocode'), '51.4,6.7');
            assert.equal(requested.searchParams.get('apiKey'), 'website-key');
            assert.equal(requested.searchParams.get('units'), 'm');
            assert.equal(requested.searchParams.get('language'), 'de-DE');
        });
    }

    it('preserves imperial units', async () => {
        const { requests } = await fetchHourly({
            station: 'TEST1',
            observation: { lat: 51.4, lon: 6.7 },
            nonMetric: true,
        });
        assert.equal(new URL(requests[0]).searchParams.get('units'), 'e');
    });

    it('does not request hourly data when forecast_hourly is disabled', async () => {
        const observation = { lat: 51.4, lon: 6.7 };
        const { data, requests } = await fetchHourly({ enabled: false, station: 'TEST1', observation });
        assert.equal(requests.length, 0);
        assert.equal(data.current_observation, observation);
        assert.equal(data.hourly_forecast, undefined);
    });

    it('retains observations when the hourly request fails', async () => {
        const observation = { lat: 51.4, lon: 6.7 };
        const { data } = await fetchHourly({ station: 'TEST1', observation, error: { response: { status: 503 } } });
        assert.equal(data.current_observation, observation);
        assert.equal(data.hourly_forecast, undefined);
    });
});
