const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '../main.js');
const adapterRequire = createRequire(main);
const source = fs.readFileSync(main, 'utf8');
const ownerKey = '0123456789abcdefFEDCBA9876543210';
const webKey = '0123456789abcdef0123456789abcdef';
const stationKey = 'syntheticLegacyKey';

async function exercise(action, outcome) {
    const logs = [];
    const requests = [];
    const reflectedUrl = `https://api.weather.com/test?apiKey=${ownerKey}`;
    const context = {
        require: name => {
            if (name === '@iobroker/adapter-core') {
                return {};
            }
            if (name === 'axios') {
                return {
                    get: url => {
                        requests.push(url);
                        if (outcome === 'http-error' || outcome === 'network-error') {
                            return Promise.reject({
                                code: 'ECONNRESET',
                                message: reflectedUrl,
                                config: { url: reflectedUrl },
                                ...(outcome === 'http-error'
                                    ? { response: { status: 503, data: { echo: reflectedUrl } } }
                                    : {}),
                            });
                        }
                        if (outcome === 'website') {
                            return Promise.resolve({
                                data: `"https://api.weather.com/v2/pws/observations/current?apiKey=${webKey}" "https://api.weather.com/v3/wx/forecast/daily/5day?apiKey=${webKey}" "https://api.weather.com/v3/wx/forecast/hourly/2day?apiKey=${webKey}"`,
                            });
                        }
                        if (outcome === 'station') {
                            return Promise.resolve({ data: `WU_LEGACY_API_KEY&q;:&q;${stationKey}&q` });
                        }
                        return Promise.resolve({
                            data: { response: { error: { description: reflectedUrl } }, echo: reflectedUrl },
                        });
                    },
                };
            }
            return adapterRequire(name);
        },
        module: { parent: true, exports: {} },
        setImmediate,
        capturedLog: message => logs.push(message),
        ownerKey,
        webKey,
        stationKey,
        reflectedUrl,
    };
    await vm.runInNewContext(
        `${source}
        adapter = {
            config: { station: 'TEST1', location: 'Berlin', country: 'DE', language: 'EN', current: true,
                forecast_periods: true, forecast_periods_txt: false, forecast_hourly: true },
            log: { debug: capturedLog, error: capturedLog, info: capturedLog, warn: capturedLog },
            setObjectNotExists: (_id, _object, callback) => callback(), setState: () => {},
        };
        officialApiKey = ownerKey;
        newWebKey = webKey;
        pwsStationKey = stationKey;
        currentObservationUrl = reflectedUrl;
        forecastDailyUrl = reflectedUrl;
        forecastHourlyUrl = reflectedUrl;
        getKeysAndData = callback => callback();
        new Promise(resolve => { ${action} });
    `,
        context,
    );
    assert.equal(logs.join('\n').includes(ownerKey), false, 'owner key leaked to logs');
    assert.equal(logs.join('\n').includes(webKey), false, 'web key leaked to logs');
    assert.equal(logs.join('\n').includes(stationKey), false, 'legacy key leaked to logs');
    return { logs, requests };
}

describe('credential-safe provider logging', () => {
    for (const outcome of ['http-error', 'network-error', 'empty']) {
        for (const [endpoint, action, key] of [
            ['current', 'getNewWuDataCurrentObservations(resolve)', ownerKey],
            ['daily', 'getNewWuDataDailyForecast({current_observation:{lat:50,lon:8}}, resolve)', ownerKey],
            ['hourly', 'getNewWuDataHourlyForecast({current_observation:{lat:50,lon:8}}, resolve)', webKey],
            ['legacy', 'getLegacyWuData(resolve)', stationKey],
        ]) {
            it(`keeps credentials in ${endpoint} requests but out of ${outcome} logs`, async () => {
                const result = await exercise(action, outcome);
                assert.ok(result.requests[0].includes(key), 'outgoing request lost its credential');
                if (outcome !== 'empty') {
                    assert.ok(
                        result.logs.some(message => message.includes(outcome === 'http-error' ? '503' : 'ECONNRESET')),
                    );
                }
            });
        }
    }

    for (const [endpoint, action] of [
        ['station', "pwsStationKey = ''; getStationKey(resolve)"],
        ['website', "newWebKey = ''; getWebsiteKey(resolve)"],
    ]) {
        for (const outcome of ['http-error', 'network-error', endpoint]) {
            it(`does not log scraped keys or reflected errors during ${endpoint} ${outcome}`, async () => {
                await exercise(action, outcome);
            });
        }
    }

    it('does not echo provider error fields when legacy parsing fails', async () => {
        await exercise(
            `adapter.config.forecast_periods = false;
            adapter.config.forecast_hourly = false;
            parseLegacyResult({ current_observation: {}, response: { error: { type: ownerKey } } }, resolve)`,
            'empty',
        );
    });

    for (const parser of ['parseLegacyResult', 'parseNewResult']) {
        it(`does not dump credential-bearing provider bodies in ${parser}`, async () => {
            await exercise(
                `adapter.config.current = false; adapter.config.forecast_periods = false;
                adapter.config.forecast_hourly = false; ${parser}({ echo: reflectedUrl }, resolve)`,
                'empty',
            );
        });
    }
});
