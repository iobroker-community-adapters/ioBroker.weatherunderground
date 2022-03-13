/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */

/**
 *
 * weatherunderground adapter
 *
 * Adapter loading the json forecast of weatherunderground
 *
 * note: you need an account and an api key to get the forecast. This is free for non excess usage: 500 requests/d
 * see: http://www.wunderground.com/weather/api/d/pricing
 *
 * register for a key:
 * http://www.wunderground.com/weather/api/d/questionnaire.html?plan=a&level=0&history=undefined
 *
 * see http://www.wunderground.com/weather/api/d/docs?d=data/hourly
 * for reference of the possible values from hourly WU forecast
 *
 */

'use strict';

const utils       = require('@iobroker/adapter-core'); // Get common adapter utils
const axios       = require('axios');
const crypto      = require('crypto');
const adapterName = require('./package.json').name.split('.').pop();
let adapter;

const dictionary = require('./lib/words');
let lang = 'en';
let locale = 'en-GB';
let nonMetric = false;
const windDirections = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N'];

let officialApiKey;
let pwsStationKey;
let newWebKey;
let currentObservationUrl;
let forecastDailyUrl;
let forecastHourlyUrl;
let errorCounter = 0;
let forceTimeout = null;

let stopInProgress = false;

const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows) Gecko/20100101 Firefox/68.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.8,en-US;q=0.5,en;q=0.3'
};

function _(text) {
    if (!text) {
        return '';
    }

    if (dictionary[text]) {
        let newText = dictionary[text][lang];
        if (newText) {
            return newText;
        } else if (lang !== 'en') {
            newText = dictionary[text].en;
            if (newText) {
                return newText;
            }
        }
    }
    return text;
}

function time2date(date) {
    return date.getDate().toString().padStart(2, '0') + '.' + (date.getMonth() + 1).toString().padStart(2, '0') + '.' + date.getFullYear();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(() => !stopInProgress && resolve(), ms));
}

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});
    adapter = new utils.Adapter(options);

    adapter.on('unload', callback => {
        stopInProgress = true;
        forceTimeout && clearTimeout(forceTimeout);
        callback && callback();
    })

    adapter.on('ready', async () => {

        officialApiKey = adapter.config.apikey;
        if (officialApiKey && officialApiKey.length > 0 && officialApiKey.length !== 32) {
            adapter.log.warn('API key invalid, please enter the new PWS owner API key or remove the key, ignoring it!');
            officialApiKey = '';
        }

        if (!officialApiKey) {
            try {
                const instObj = await adapter.getForeignObjectAsync(`system.adapter.${adapter.namespace}`);
                if (instObj && instObj.common && instObj.common.schedule && instObj.common.schedule === '12 * * * *') {
                    instObj.common.schedule = `${Math.floor(Math.random() * 60)} * * * *`;
                    adapter.log.info(`Default schedule found and adjusted to spread calls better over the full hour!`);
                    await adapter.setForeignObjectAsync(`system.adapter.${adapter.namespace}`, instObj);
                    adapter.terminate ? adapter.terminate() : process.exit(0);
                    return;
                }
            } catch (err) {
                adapter.log.error(`Could not check or adjust the schedule: ${err.message}`);
            }

            const delay = Math.floor(Math.random() * 30000);
            adapter.log.debug(`Delay execution by ${delay}ms to better spread API calls`);
            await sleep(delay);
        }

        adapter.config.language = adapter.config.language || 'DL';

        switch (adapter.config.language) {
            case 'DL':
                lang = 'de';
                locale = 'de-DE';
                break;
            case 'EN':
                lang = 'en';
                locale = 'en-GB';
                break;
            case 'RU':
                lang = 'ru';
                locale = 'ru-RU';
                break;
            case 'NL':
                lang = 'nl';
                locale = 'nl-NL';
                break;
        }

        if (!adapter.config.country) {
            adapter.config.country = 'DE';
        }

        if (adapter.config.useLegacyApi === undefined) {
            adapter.config.useLegacyApi = true;
        }

        adapter.config.useLegacyApi = false;
        if (typeof adapter.config.forecast_periods_txt === 'undefined') {
            adapter.log.info('forecast_periods_txt not defined. now enabled. check settings and save');
            adapter.config.forecast_periods_txt = true;
        }
        if (typeof adapter.config.forecast_periods === 'undefined') {
            adapter.log.info('forecast_periods not defined. now enabled. check settings and save');
            adapter.config.forecast_periods = true;
        }
        if (typeof adapter.config.forecast_hourly === 'undefined') {
            adapter.log.info('forecast_hourly not defined. now enabled. check settings and save');
            adapter.config.forecast_hourly = true;
        }
        if (typeof adapter.config.current === 'undefined') {
            adapter.log.info('current not defined. now enabled. check settings and save');
            adapter.config.current = true;
        }
        if (typeof adapter.config.custom_icon_base_url === 'undefined') {
            adapter.config.custom_icon_base_url = '';
        } else {
            adapter.config.custom_icon_base_url = adapter.config.custom_icon_base_url.trim();
            if (adapter.config.custom_icon_base_url && adapter.config.custom_icon_base_url[adapter.config.custom_icon_base_url.length - 1] !== '/') {
                adapter.config.custom_icon_base_url += '/';
            }
        }
        if (typeof adapter.config.custom_icon_format === 'undefined') {
            adapter.config.custom_icon_format = 'gif';
        }
        adapter.log.debug('on ready: ' + adapter.config.language + ' ' + adapter.config.forecast_periods_txt + ' ' + adapter.config.forecast_periods + ' ' + adapter.config.current + ' ' + adapter.config.forecast_hourly);

        nonMetric = !!adapter.config.nonMetric;

        await checkWeatherVariables();

        adapter.getState('currentStationKey', (err, state) => {
            if (!err && state && state.val) {
                if (typeof state.val !== 'string') state.val = state.val.toString();
                pwsStationKey = state.val;
                adapter.log.debug('initialize PWS Station Key: ' + pwsStationKey);
            }
            adapter.getState('currentWebKey', (err, state) => {
                if (!err && state && state.val) {
                    if (typeof state.val !== 'string') state.val = state.val.toString();
                    newWebKey = state.val;
                    adapter.log.debug('initialize Web Key: ' + newWebKey);
                }

                adapter.getState('currentObservationUrl', (err, state) => {
                    if (!err && state && state.val) {
                        if (typeof state.val !== 'string') state.val = state.val.toString();
                        currentObservationUrl = state.val;
                        adapter.log.debug('initialize Current Observation url: ' + currentObservationUrl);
                    }

                    adapter.getState('forecastDailyUrl', (err, state) => {
                        if (!err && state && state.val) {
                            if (typeof state.val !== 'string') state.val = state.val.toString();
                            forecastDailyUrl = state.val;
                            adapter.log.debug('initialize Daily Forecast Url: ' + forecastDailyUrl);
                            if (forecastDailyUrl.includes('/v1/')) {
                                adapter.log.debug('    Daily Forecast Url incompatible ... refetch');
                                forecastDailyUrl = '';
                            }
                        }

                        adapter.getState('forecastHourlyUrl', (err, state) => {
                            if (!err && state && state.val) {
                                if (typeof state.val !== 'string') state.val = state.val.toString();
                                forecastHourlyUrl = state.val;
                                adapter.log.debug('initialize Hourly Forecast Url: ' + forecastHourlyUrl);
                                if (forecastHourlyUrl.includes('/v1/')) {
                                    adapter.log.debug('    Daily Forecast Url incompatible ... refetch');
                                    forecastHourlyUrl = '';
                                }
                            }

                            adapter.getState('locationChecksum', (err, state) => {

                                const locationHash = crypto.createHash('md5').update(adapter.config.location + adapter.config.station).digest('hex');
                                let locationChange = true;
                                if (!err && state && state.val && locationHash === state.val) {
                                    adapter.log.debug('location has not changed, reuse extracted URLs');
                                    locationChange = false;
                                }
                                if (locationChange) {
                                    adapter.log.debug('location change detected, extract URLs');
                                    currentObservationUrl = null;
                                    forecastDailyUrl = null;
                                    forecastHourlyUrl = null;

                                    adapter.setObjectNotExists('locationChecksum', {
                                        type: 'state',
                                        common: {type: 'string', role: 'text', name: 'Helper state to detect location changes', def: ''},
                                        native: {id: 'locationChecksum'}
                                    }, () => adapter.setState('locationChecksum', {val: locationHash, ack: true}));
                                }

                                getKeysAndData(() => {
                                    forceTimeout && clearTimeout(forceTimeout);
                                    forceTimeout = setTimeout(() => adapter.stop(), 2000);
                                });
                            });
                        });
                    });
                });
            });
        });

        // force terminate after 1min
        // don't know why it does not terminate by itself...
        forceTimeout = setTimeout(() => {
            forceTimeout = null;
            stopInProgress = true;
            adapter.log.warn('force terminate');
            adapter.terminate ? adapter.terminate() : process.exit(0);
        }, 60000);
    });

    return adapter;
}

function getKeysAndData(cb) {
    if (errorCounter > 2) {
        if (adapter.config.useLegacyApi) {
            adapter.config.useLegacyApi = false;
            errorCounter = 0;
        } else {
            return cb();
        }
    }
    getApiKey(() => {
        if (stopInProgress) return;
        if (adapter.config.useLegacyApi) {
            adapter.log.debug('Use Legacy API');
            getLegacyWuData(cb);
        } else {
            adapter.log.debug('Use New API');
            getNewWuDataCurrentObservations(data => getNewWuDataDailyForecast(data, (data) => getNewWuDataHourlyForcast(data, (data) => parseNewResult(data, cb))));
        }
    });
}


function handleIconUrl(original) {
    if (!original) return original;
    let iconSet = adapter.config.iconSet;
    if (typeof original !== 'string') {
        original = original.toString();
    }
    if (original.match(/^[0-9]{1,4}$/)) {
        original = 'https://icons.wxug.com/i/c/v4/' + original + '.svg';
        if (iconSet === 'i') iconSet = null;
    }
    if (iconSet) {
        original = 'https://icons.wxug.com/i/c/' + encodeURIComponent(iconSet) + '/' + original.substring(original.lastIndexOf('/') + 1);
    }
    else if (adapter.config.custom_icon_base_url) {
        const pos = original.lastIndexOf('.');

        if (original.substring(pos + 1) !== adapter.config.custom_icon_format) {
            original = original.replace(/\.\w+$/, '.' + adapter.config.custom_icon_format);
        }

        original = adapter.config.custom_icon_base_url + original.substring(original.lastIndexOf('/') + 1);

    }
    return original;
}

function getApiKey(cb) {
    getStationKey(() => getWebsiteKey( () => cb()));
}

function getStationKey(cb) {
    if (pwsStationKey && pwsStationKey.length) {
        return cb && cb();
    }

    let url = 'https://www.wunderground.com/dashboard/pws/IBERLIN1658';

    if (adapter.config.station) {
        adapter.config.station = adapter.config.station.trim();
        if (adapter.config.station.startsWith('pws:')) {
            adapter.config.station = adapter.config.station.substr(4).trim();
        }
        if (/[^A-Z0-9]/.test(adapter.config.station)) {
            adapter.log.info(`Please check the configured station-id "${adapter.config.station}" if it do not work because usually station ids consist of capital letters and numbers only!`)
        }
        url = 'https://www.wunderground.com/dashboard/pws/' + encodeURIComponent(adapter.config.station);
    }
    else {
        adapter.log.info('using fallback station ID to get key because no PWS station ID provided.');
    }

    adapter.log.debug('get PWS dashboard page: ' + url);

    axios.get(url, {
        headers: requestHeaders,
        timeout: 15000,
        validateStatus: status => status === 200
    })
        .then(response => {
            const body = response.data;
            const scriptFile = body.match(/<script src="(.*\/wui-pwsdashboard\/.*wui.pwsdashboard.min.js)"><\/script>/);
            if (!scriptFile || !scriptFile[1]) {
                const pwsApiKey = body.match(/WU_LEGACY_API_KEY&q;:&q;([^&]+)&q/);
                if (!pwsApiKey || !pwsApiKey[1]) {
                    return cb && cb();
                }
                pwsStationKey = pwsApiKey[1];
                adapter.log.debug('fetched new stationKey from WU webpage-0419: ' + pwsStationKey);
                adapter.setObjectNotExists('currentStationKey', {
                    type: 'state',
                    common: {type: 'string', role: 'text', name: 'Current Station API Key from webpage', def: ''},
                    native: {id: 'currentStationKey'}
                }, () => {
                    adapter.setState('currentStationKey', {val: pwsStationKey, ack: true});
                });

                return cb && cb();
            }
            if (scriptFile[1].startsWith('//')) {
                scriptFile[1] = 'https:' + scriptFile[1];
            }

            adapter.log.debug('get PWS dashboard script: ' + scriptFile[1]);
            return axios.get(scriptFile[1], {
                headers: requestHeaders,
                timeout: 15000,
                validateStatus: status => status === 200
            });
        })
        .then(response => {
            const body = response.data;
            if (stopInProgress) {
                return;
            }
            // "https://api.wunderground.com/api/606f3f6977348613/conditions/forecast10day/hourly10day/astronomy10day/pwsidentity/units:" + units + "/v:2.0/q/pws:" + stationid + ".json?ID=" + stationid + "&callback=?"
            const pwsApiKey = body.match(/https:\/\/api.wunderground.com\/api\/([^\/]+)\/conditions\//);
            if (!pwsApiKey || !pwsApiKey[1]) {
                return cb && cb();
            }
            pwsStationKey = pwsApiKey[1];
            adapter.log.debug('fetched new stationKey from WU webpage: ' + pwsStationKey);
            adapter.setObjectNotExists('currentStationKey', {
                type: 'state',
                common: {type: 'string', role: 'text', name: 'Current Station API Key from webpage', def: ''},
                native: {id: 'currentStationKey'}
            }, () => {
                adapter.setState('currentStationKey', {val: pwsStationKey, ack: true});
            });

            return cb && cb();
        })
        .catch(error => {
            // ERROR
            adapter.log.error(`Unable to get PWS dashboard script: ${error.response ? error.response.statusCode : '--'}/${error.response && error.response.data ? JSON.stringify(error.response.data) : JSON.stringify(error)}`);
            return cb && cb();
        });
}

function getWebsiteKey(cb, tryQ) {
    if (newWebKey && currentObservationUrl && forecastDailyUrl && forecastHourlyUrl) {
        return cb && cb();
    }

    let url;
    if (adapter.config.location.startsWith('pws:') || adapter.config.location.match(/^[A-Z]+[0-9]{1,4}$/) || adapter.config.location.match(/^[0-9]+\.[0-9]+ *, *[0-9]+\.[0-9]+$/)) { // Geocode
        url = `https://www.wunderground.com/hourly/${tryQ ? 'q/' : ''}${encodeURIComponent(adapter.config.location)}`;
    } else {
        url = `https://www.wunderground.com/hourly/${encodeURIComponent(adapter.config.country)}/${tryQ ? 'q/' : ''}${encodeURIComponent(adapter.config.location)}`;
    }

    adapter.log.debug('get WU weather page: ' + url);

    axios.get(url, {
        headers: requestHeaders,
        timeout: 15000,
        validateStatus: status => status === 200
    })
        .then(response => {
            if (stopInProgress) {
                return;
            }
            let body = response.data;
            if (body) {
                body = body.replace(/&q;/g, '"').replace(/&a;/g, '&');
            }
            const data = body.match(/api\.weather\.com\/.*apiKey=([0-9a-zA-Z]{32}).*/);
            if (!data || !data[1]) {
                return cb && cb();
            }
            newWebKey = data[1];
            adapter.log.debug('fetched new webkey from WU weather page: ' + newWebKey);
            adapter.setObjectNotExists('currentWebKey', {
                type: 'state',
                common: {type: 'string', role: 'text', name: 'Current Web Key from webpage', def: ''},
                native: {id: 'currentWebKey'}
            }, () => {
                adapter.setState('currentWebKey', {val: newWebKey, ack: true});
            });

            const currentObservation = body.match(/"(https:\/\/api\.weather\.com\/[^"]+\/observations\/current[^"]+)"/);
            if (currentObservation && currentObservation[1]) {
                currentObservationUrl = currentObservation[1];
                adapter.log.debug('fetched current observations Url from WU weather page: ' + currentObservationUrl);
                adapter.setObjectNotExists('currentObservationUrl', {
                    type: 'state',
                    common: {type: 'string', role: 'text', name: 'Current Observations Url', def: ''},
                    native: {id: 'currentObservationUrl'}
                }, () => {
                    adapter.setState('currentObservationUrl', {val: currentObservationUrl, ack: true});
                });
            }

            const forecastDaily = body.match(/"(https:\/\/api\.weather\.com\/[^"]+\/forecast\/daily\/[^"]+)"/);
            //adapter.log.debug('body match forecast: ' + data);
            if (forecastDaily && forecastDaily[1]) {
                forecastDailyUrl = forecastDaily[1];
                adapter.log.debug('fetched forecast 5 day Url from WU weather page: ' + forecastDailyUrl);
                adapter.setObjectNotExists('forecastDailyUrl', {
                    type: 'state',
                    common: {type: 'string', role: 'text', name: 'Daily Forecast Url', def: ''},
                    native: {id: 'forecastDailyUrl'}
                }, () => {
                    adapter.setState('forecastDailyUrl', {val: forecastDailyUrl, ack: true});
                });
            }

            const forecastHourly = body.match(/"(https:\/\/api\.weather\.com\/[^"]+\/forecast\/hourly\/[^"]+)"/);
            if (forecastHourly && forecastHourly[1]) {
                forecastHourlyUrl = forecastHourly[1];
                adapter.log.debug('fetched hourly forecast Url from WU weather page: ' + forecastHourlyUrl);
                adapter.setObjectNotExists('forecastHourlyUrl', {
                    type: 'state',
                    common: {type: 'string', role: 'text', name: 'Hourly Forecast Url', def: ''},
                    native: {id: 'forecastHourlyUrl'}
                }, () => {
                    adapter.setState('forecastHourlyUrl', {val: forecastHourlyUrl, ack: true});
                });
            }
            return cb && cb();
        })
        .catch(error => {
            if (error.response && error.response.status === 404 && !tryQ) {
                getWebsiteKey(cb, true);
            } else if (error.response && error.response.status === 404) {
                adapter.log.error('The given Location can not be found. Please check on https://wunderground.com or try geo coordinates (lat,lon) or nearby cities!');
                return cb && cb();
            } else {
                // ERROR
                adapter.log.error(`Unable to get PWS dashboard script: ${error.response ? error.response.statusCode : '--'}/${error.response && error.response.data ? JSON.stringify(error.response.data) : JSON.stringify(error)}`);
                return cb && cb();
            }
        });
}

async function parseLegacyResult(body, cb) {
    let qpfMax = 0;
    let popMax = 0;
    let uviSum = 0;

    adapter.log.debug(`Process legacy results: ${JSON.stringify(body)}`);

    if (adapter.config.current) {
        if (body.current_observation) {
            try {
                await adapter.setStateAsync('forecast.current.displayLocationFull', {
                    ack: true,
                    val: body.current_observation.display_location.full
                });
                await adapter.setStateAsync('forecast.current.displayLocationLatitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.display_location.latitude)
                });
                await adapter.setStateAsync('forecast.current.displayLocationLongitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.display_location.longitude)
                });
                await adapter.setStateAsync('forecast.current.displayLocationElevation', {
                    ack: true,
                    val: parseFloat(body.current_observation.display_location.elevation)
                });

                await adapter.setStateAsync('forecast.current.observationLocationFull', {
                    ack: true,
                    val: body.current_observation.observation_location.full
                });
                await adapter.setStateAsync('forecast.current.observationLocationLatitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.observation_location.latitude)
                });
                await adapter.setStateAsync('forecast.current.observationLocationLongitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.observation_location.longitude)
                });
                if (nonMetric) {
                    await adapter.setStateAsync('forecast.current.observationLocationElevation', {
                        ack: true,
                        val: (parseFloat(body.current_observation.observation_location.elevation))
                    }); // ft
                } else {
                    await adapter.setStateAsync('forecast.current.observationLocationElevation', {
                        ack: true,
                        val: (Math.round(parseFloat(body.current_observation.observation_location.elevation) * 0.3048) * 100) / 100
                    }); // convert ft to m
                }

                await adapter.setStateAsync('forecast.current.observationLocationStationID', {
                    ack: true,
                    val: body.current_observation.station_id
                });
                await adapter.setStateAsync('forecast.current.localTimeRFC822', {
                    ack: true,
                    val: body.current_observation.local_time_rfc822
                });
                await adapter.setStateAsync('forecast.current.observationTimeRFC822', {
                    ack: true,
                    val: body.current_observation.observation_time_rfc822
                }); // PDE
                await adapter.setStateAsync('forecast.current.observationTime', {
                    ack: true,
                    val: new Date(parseInt(body.current_observation.local_epoch, 10) * 1000).toLocaleString()
                }); // PDE

                await adapter.setStateAsync('forecast.current.weather', {ack: true, val: body.current_observation.weather});
                if (nonMetric) {
                    await adapter.setStateAsync('forecast.current.temp', {ack: true, val: parseFloat(body.current_observation.temp_f)});
                } else {
                    await adapter.setStateAsync('forecast.current.temp', {ack: true, val: parseFloat(body.current_observation.temp_c)});
                }
                await adapter.setStateAsync('forecast.current.relativeHumidity', {
                    ack: true,
                    val: parseFloat(body.current_observation.relative_humidity.replace('%', ''))
                });
                await adapter.setStateAsync('forecast.current.windDegrees', {
                    ack: true,
                    val: parseFloat(body.current_observation.wind_degrees)
                });
                await adapter.setStateAsync('forecast.current.windDirection', {
                    ack: true,
                    val: windDirections[Math.floor((body.current_observation.wind_degrees + 11.25) / 22.5)]
                });
                if (nonMetric) {
                    await adapter.setStateAsync('forecast.current.wind', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_mph)
                    });
                    await adapter.setStateAsync('forecast.current.windGust', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_gust_mph)
                    });
                } else {
                    await adapter.setStateAsync('forecast.current.wind', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_kph)
                    });
                    await adapter.setStateAsync('forecast.current.windGust', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_gust_kph)
                    });
                }

                await adapter.setStateAsync('forecast.current.pressure', {
                    ack: true,
                    val: parseFloat(body.current_observation.pressure_mb)
                }); //PDE
                if (nonMetric) {
                    await adapter.setStateAsync('forecast.current.dewPoint', {
                        ack: true,
                        val: body.current_observation.dewpoint_f === 'NA' ? null : parseFloat(body.current_observation.dewpoint_f)
                    });
                    await adapter.setStateAsync('forecast.current.windChill', {
                        ack: true,
                        val: body.current_observation.windchill_f === 'NA' ? null : parseFloat(body.current_observation.windchill_f)
                    });
                    await adapter.setStateAsync('forecast.current.feelsLike', {
                        ack: true,
                        val: body.current_observation.feelslike_f === 'NA' ? null : parseFloat(body.current_observation.feelslike_f)
                    });
                    await adapter.setStateAsync('forecast.current.visibility', {
                        ack: true,
                        val: parseFloat(body.current_observation.visibility_mi)
                    });
                } else {
                    await adapter.setStateAsync('forecast.current.dewPoint', {
                        ack: true,
                        val: body.current_observation.dewpoint_c === 'NA' ? null : parseFloat(body.current_observation.dewpoint_c)
                    });
                    await adapter.setStateAsync('forecast.current.windChill', {
                        ack: true,
                        val: body.current_observation.windchill_c === 'NA' ? null : parseFloat(body.current_observation.windchill_c)
                    });
                    await adapter.setStateAsync('forecast.current.feelsLike', {
                        ack: true,
                        val: body.current_observation.feelslike_c === 'NA' ? null : parseFloat(body.current_observation.feelslike_c)
                    });
                    await adapter.setStateAsync('forecast.current.visibility', {
                        ack: true,
                        val: parseFloat(body.current_observation.visibility_km)
                    });
                }
                await adapter.setStateAsync('forecast.current.solarRadiation', {
                    ack: true,
                    val: body.current_observation.solarradiation
                });
                await adapter.setStateAsync('forecast.current.UV', {ack: true, val: parseFloat(body.current_observation.UV)});
                if (nonMetric) {
                    if (!isNaN(parseInt(body.current_observation.precip_1hr_in, 10))) {
                        await adapter.setStateAsync('forecast.current.precipitationHour', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_1hr_in, 10)
                        });
                    }
                    if (!isNaN(parseInt(body.current_observation.precip_today_in, 10))) {
                        await adapter.setStateAsync('forecast.current.precipitationDay', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_today_in, 10)
                        });
                    }
                } else {
                    if (!isNaN(parseInt(body.current_observation.precip_1hr_metric, 10))) {
                        await adapter.setStateAsync('forecast.current.precipitationHour', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_1hr_metric, 10)
                        });
                    }
                    if (!isNaN(parseInt(body.current_observation.precip_today_metric, 10))) {
                        await adapter.setStateAsync('forecast.current.precipitationDay', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_today_metric, 10)
                        });
                    }
                }

                await adapter.setStateAsync('forecast.current.iconURL', {
                    ack: true,
                    val: handleIconUrl(body.current_observation.icon_url)
                });
                await adapter.setStateAsync('forecast.current.forecastURL', {
                    ack: true,
                    val: body.current_observation.forecast_url
                });
                await adapter.setStateAsync('forecast.current.historyURL', {ack: true, val: body.current_observation.history_url});
                adapter.log.debug('all current conditions values set');
            } catch (error) {
                adapter.log.error('Could not parse Conditions-Data: ' + error);
                adapter.log.error('Reported WU-Error Type: ' + body.response.error.type);
            }
        } else {
            adapter.log.error('No current observation data found in response');
        }
    }

    //next 8 periods (day and night) -> text and icon forecast
    if (adapter.config.forecast_periods_txt) {
        if (body.forecast && body.forecast.txt_forecast && body.forecast.txt_forecast.forecastday) {
            for (let i = 0; i < 8; i++) {
                if (!body.forecast.txt_forecast.forecastday[i]) continue;
                try {
                    const now = new Date();
                    now.setHours(now.getHours() + body.forecast.txt_forecast.forecastday[i].period * 12);

                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.date', {
                        ack: true,
                        val: time2date(now)
                    });
                    let iconId = parseInt(body.forecast.txt_forecast.forecastday[i].icon, 10);
                    if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                        iconId = body.forecast.txt_forecast.forecastday[i].icon;
                    }
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.icon', {
                        ack: true,
                        val: iconId
                    });
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.iconURL', {
                        ack: true,
                        val: handleIconUrl(body.forecast.txt_forecast.forecastday[i].icon_url)
                    });
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.title', {
                        ack: true,
                        val: body.forecast.txt_forecast.forecastday[i].title
                    });
                    if (nonMetric) {
                        await adapter.setStateAsync('forecastPeriod.' + i + 'p.state', {
                            ack: true,
                            val: body.forecast.txt_forecast.forecastday[i].fcttext
                        });
                    } else {
                        await adapter.setStateAsync('forecastPeriod.' + i + 'p.state', {
                            ack: true,
                            val: body.forecast.txt_forecast.forecastday[i].fcttext_metric
                        });
                    }
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.precipitationChance', {
                        ack: true,
                        val: body.forecast.txt_forecast.forecastday[i].pop
                    });
                }
                catch (error) {
                    adapter.log.error('exception in : body.txt_forecast' + error);
                }
            }
        }
    }

    if (adapter.config.forecast_periods) {
        //next 4 days
        if (body.forecast && body.forecast.simpleforecast && body.forecast.simpleforecast.forecastday) {
            for (let i = 0; i < 4; i++) {
                if (!body.forecast.simpleforecast.forecastday[i]) continue;
                try {
                    await adapter.setStateAsync('forecast.' + i + 'd.date', {
                        ack: true,
                        val: time2date(new Date(parseInt(body.forecast.simpleforecast.forecastday[i].date.epoch, 10) * 1000))
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.tempMax', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].high.fahrenheit) : parseFloat(body.forecast.simpleforecast.forecastday[i].high.celsius)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.tempMin', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].low.fahrenheit) : parseFloat(body.forecast.simpleforecast.forecastday[i].low.celsius)
                    });
                    let iconId = parseInt(body.forecast.simpleforecast.forecastday[i].icon, 10);
                    if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                        iconId = body.forecast.simpleforecast.forecastday[i].icon;
                    }
                    await adapter.setStateAsync('forecast.' + i + 'd.icon', {
                        ack: true,
                        val: iconId
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.state', {
                        ack: true,
                        val: _('state_' + body.forecast.simpleforecast.forecastday[i].icon)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.iconURL', {
                        ack: true,
                        val: handleIconUrl(body.forecast.simpleforecast.forecastday[i].icon_url)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationChance', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].pop
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationAllDay', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].qpf_allday.in) : parseFloat(body.forecast.simpleforecast.forecastday[i].qpf_allday.mm)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationDay', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].qpf_day.in) : parseFloat(body.forecast.simpleforecast.forecastday[i].qpf_day.mm)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationNight', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].qpf_night.in) : parseFloat(body.forecast.simpleforecast.forecastday[i].qpf_night.mm)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowAllDay', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].snow_allday.in) : parseFloat(body.forecast.simpleforecast.forecastday[i].snow_allday.cm)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowDay', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].snow_day.in) : parseFloat(body.forecast.simpleforecast.forecastday[i].snow_day.cm)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowNight', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].snow_night.in) : parseFloat(body.forecast.simpleforecast.forecastday[i].snow_night.cm)
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.windSpeedMax', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].maxwind.mph) : parseFloat(body.forecast.simpleforecast.forecastday[i].maxwind.kph)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDirectionMax', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].maxwind.dir
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDegreesMax', {
                        ack: true,
                        val: parseFloat(body.forecast.simpleforecast.forecastday[i].maxwind.degrees)
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.windSpeed', {
                        ack: true,
                        val: nonMetric ? parseFloat(body.forecast.simpleforecast.forecastday[i].avewind.mph) : parseFloat(body.forecast.simpleforecast.forecastday[i].avewind.kph)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDirection', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].avewind.dir
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDegrees', {
                        ack: true,
                        val: parseFloat(body.forecast.simpleforecast.forecastday[i].avewind.degrees)
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.humidity', {
                        ack: true,
                        val: parseFloat(body.forecast.simpleforecast.forecastday[i].avehumidity)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.humidityMax', {
                        ack: true,
                        val: parseFloat(body.forecast.simpleforecast.forecastday[i].maxhumidity)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.humidityMin', {
                        ack: true,
                        val: parseFloat(body.forecast.simpleforecast.forecastday[i].minhumidity)
                    });
                }
                catch (error) {
                    adapter.log.error('exception in : body.simpleforecast' + error);
                }
            }
        }
    }

    // next 36 hours
    if (adapter.config.forecast_hourly) {
        if (body.hourly_forecast) {
            const type = nonMetric ? 'english' : 'metric';
            for (let i = 0; i < 36; i++) {
                //if (!body.hourly_forecast[i]) continue;
                try {
                    // see http://www.wunderground.com/weather/api/d/docs?d=resources/phrase-glossary for infos about properties and codes
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.time', {
                        ack: true,
                        val: new Date(parseInt(body.hourly_forecast.validTimeUtc[i], 10) * 1000).toString()
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.temp', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.temperature[i])
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.fctcode', {
                        ack: true,
                        val: body.hourly_forecast.iconCode[i]
                    }); //forecast description number -> see link above
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.sky', {ack: true, val: body.hourly_forecast.cloudCover[i]}); //?
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.windSpeed', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.windSpeed[i])
                    }); // windspeed in kmh
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.windDirection', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.windDirection[i])
                    }); //wind dir in degrees
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.uv', {ack: true, val: parseFloat(body.hourly_forecast.uvIndex[i])}); //UV Index -> wikipedia
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.humidity', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.relativeHumidity[i])
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.heatIndex', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.temperatureHeatIndex[i])
                    }); // -> wikipedia
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.feelsLike', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.temperatureFeelsLike[i])
                    }); // -> wikipedia
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.precipitation', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.qpf[i])
                    }); // Quantitative precipitation forecast
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.snow', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.qpfSnow[i])
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.precipitationChance', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.precipChance[i])
                    }); // probability of Precipitation
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.mslp', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.pressureMeanSeaLevel[i])
                    }); // mean sea level pressure
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.visibility', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.visibility[i])
                    });

                    qpfMax += Number(body.hourly_forecast.qpf[i]);
                    uviSum += Number(body.hourly_forecast.uvIndex[i]);
                    if (Number(body.hourly_forecast.precipChance[i]) > popMax) {
                        popMax = Number(body.hourly_forecast.precipChance[i]);
                    }

                    // 6h
                    if (i === 5) {
                        await adapter.setStateAsync('forecastHourly.6h.sum.precipitation', {ack: true, val: qpfMax});
                        await adapter.setStateAsync('forecastHourly.6h.sum.precipitationChance', {ack: true, val: popMax});
                        await adapter.setStateAsync('forecastHourly.6h.sum.uv', {ack: true, val: uviSum / 6});
                    }
                    // 12h
                    if (i === 11) {
                        await adapter.setStateAsync('forecastHourly.12h.sum.precipitation', {ack: true, val: qpfMax});
                        await adapter.setStateAsync('forecastHourly.12h.sum.precipitationChance', {ack: true, val: popMax});
                        await adapter.setStateAsync('forecastHourly.12h.sum.uv', {ack: true, val: uviSum / 12});
                    }
                    // 24h
                    if (i === 23) {
                        await adapter.setStateAsync('forecastHourly.24h.sum.precipitation', {ack: true, val: qpfMax});
                        await adapter.setStateAsync('forecastHourly.24h.sum.precipitationChance', {ack: true, val: popMax});
                        await adapter.setStateAsync('forecastHourly.24h.sum.uv', {ack: true, val: uviSum / 24});
                    }
                } catch (error) {
                    adapter.log.error('Could not parse Forecast-Data: ' + error);
                    adapter.log.error('Reported WU-Error Type: ' + body.response.error.type);
                }
            }

            adapter.log.debug('all forecast values set');
        }

        else {
            adapter.log.error('No forecast data found in response');
        }
    }

    cb && cb();
}

async function parseNewResult(body, cb) {
    let qpfMax = 0;
    let popMax = 0;
    let uviSum = 0;

    adapter.log.debug(`Process new results: ${JSON.stringify(body)}`);

    if (!body || !Object.keys(body).length) {
        adapter.log.error('No data received!');
        return cb && cb();
    }
    if (adapter.config.current) {
        if (body.current_observation) {
            if (nonMetric && body.current_observation.imperial) {
                body.current_observation.metric = body.current_observation.imperial;
            }
            try {
                await adapter.setStateAsync('forecast.current.displayLocationFull', {
                    ack: true,
                    val: body.current_observation.neighborhood
                });
                await adapter.setStateAsync('forecast.current.displayLocationLatitude', {
                    ack: true,
                    val: body.current_observation.lat
                });
                await adapter.setStateAsync('forecast.current.displayLocationLongitude', {
                    ack: true,
                    val: body.current_observation.lon
                });
                await adapter.setStateAsync('forecast.current.displayLocationElevation', {
                    ack: true,
                    val: body.current_observation.metric.elev
                });

                await adapter.setStateAsync('forecast.current.observationLocationFull', {
                    ack: true,
                    val: body.current_observation.neighborhood
                });
                await adapter.setStateAsync('forecast.current.observationLocationLatitude', {
                    ack: true,
                    val: body.current_observation.lat
                });
                await adapter.setStateAsync('forecast.current.observationLocationLongitude', {
                    ack: true,
                    val: body.current_observation.lon
                });
                await adapter.setStateAsync('forecast.current.observationLocationElevation', {
                    ack: true,
                    val: body.current_observation.metric.elev
                });

                await adapter.setStateAsync('forecast.current.observationLocationStationID', {
                    ack: true,
                    val: body.current_observation.stationID
                });
                await adapter.setStateAsync('forecast.current.localTimeRFC822', {
                    ack: true,
                    val: body.current_observation.obsTimeLocal
                });
                await adapter.setStateAsync('forecast.current.observationTimeRFC822', {
                    ack: true,
                    val: body.current_observation.obsTimeLocal
                }); // PDE
                await adapter.setStateAsync('forecast.current.observationTime', {
                    ack: true,
                    val: new Date(body.current_observation.obsTimeUtc).toLocaleString()
                }); // PDE

                await adapter.setStateAsync('forecast.current.weather', {
                    ack: true,
                    val: null
                });
                await adapter.setStateAsync('forecast.current.temp', {
                    ack: true,
                    val: body.current_observation.metric.temp
                });

                await adapter.setStateAsync('forecast.current.relativeHumidity', {
                    ack: true,
                    val: body.current_observation.humidity
                });
                await adapter.setStateAsync('forecast.current.windDegrees', {
                    ack: true,
                    val: body.current_observation.winddir
                });
                await adapter.setStateAsync('forecast.current.windDirection', {
                    ack: true,
                    val: windDirections[Math.floor((body.current_observation.winddir + 11.25) / 22.5)]
                });
                await adapter.setStateAsync('forecast.current.wind', {
                    ack: true,
                    val: body.current_observation.metric.windSpeed
                });
                await adapter.setStateAsync('forecast.current.windGust', {
                    ack: true,
                    val: body.current_observation.metric.windGust
                });

                await adapter.setStateAsync('forecast.current.pressure', {
                    ack: true,
                    val: body.current_observation.metric.pressure
                }); //PDE
                await adapter.setStateAsync('forecast.current.dewPoint', {
                    ack: true,
                    val: body.current_observation.metric.dewpt
                });
                await adapter.setStateAsync('forecast.current.windChill', {
                    ack: true,
                    val: body.current_observation.metric.windChill
                });
                await adapter.setStateAsync('forecast.current.feelsLike', {
                    ack: true,
                    val: body.current_observation.metric.heatIndex
                });
                await adapter.setStateAsync('forecast.current.visibility', {
                    ack: true,
                    val: null
                });
                await adapter.setStateAsync('forecast.current.solarRadiation', {
                    ack: true,
                    val: body.current_observation.solarRadiation
                });
                await adapter.setStateAsync('forecast.current.UV', {
                    ack: true,
                    val: body.current_observation.uv
                });

                await adapter.setStateAsync('forecast.current.precipitationHour', {
                    ack: true,
                    val: body.current_observation.metric.precipRate
                });
                await adapter.setStateAsync('forecast.current.precipitationDay', {
                    ack: true,
                    val: body.current_observation.metric.precipTotal
                });

                await adapter.setStateAsync('forecast.current.iconURL', {
                    ack: true,
                    val: null
                });
                await adapter.setStateAsync('forecast.current.forecastURL', {
                    ack: true,
                    val: null
                });
                await adapter.setStateAsync('forecast.current.historyURL', {
                    ack: true,
                    val: null
                });
                adapter.log.debug('all current conditions values set');
            } catch (error) {
                adapter.log.error('Could not parse Conditions-Data: ' + error);
            }
        } else {
            adapter.log.error('No current observation data found in response');
        }
    }

    //next 8 periods (day and night) -> text and icon forecast
    if (adapter.config.forecast_periods_txt) {
        if (body.daily_forecast && body.daily_forecast.daypart) {
            const startId = (body.daily_forecast.daypart[0].daypartName[0] === null) ? 1 : 0;
            for (let i = 0; i < 8; i++) {
                const idx = startId + i;
                try {
                    const now = new Date();
                    now.setHours(7 + idx * 12);

                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.date', {
                        ack: true,
                        val: time2date(now)
                    });
                    let iconId = parseInt(body.daily_forecast.daypart[0].iconCode[idx], 10);
                    if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                        iconId = body.daily_forecast.daypart[0].iconCode[idx];
                    }
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.icon', {
                        ack: true,
                        val: iconId
                    });
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.iconURL', {
                        ack: true,
                        val: handleIconUrl(iconId)
                    });
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.title', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].daypartName[idx]
                    });
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.state', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].narrative[idx]
                    });
                    await adapter.setStateAsync('forecastPeriod.' + i + 'p.precipitationChance', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].precipChance[idx]
                    });
                }
                catch (error) {
                    adapter.log.error('exception in : body.daily_forecast' + error);
                }
            }
        }
        else if (body.daily_forecast2) {
            let idx = 0;
            for (let i = 0; i < 5; i++) {
                try {
                    if (body.daily_forecast2[i].day) {
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.date', {
                            ack: true,
                            val: time2date(new Date(body.daily_forecast2[i].day.fcst_valid_local))
                        });
                        let iconId = parseInt(body.daily_forecast2[i].day.icon_code, 10);
                        if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                            iconId = body.daily_forecast2[i].day.icon_code;
                        }
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.icon', {
                            ack: true,
                            val: iconId
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.iconURL', {
                            ack: true,
                            val: handleIconUrl(iconId)
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.title', {
                            ack: true,
                            val: body.daily_forecast2[i].day.daypart_name
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.state', {
                            ack: true,
                            val: body.daily_forecast2[i].day.narrative
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.precipitationChance', {
                            ack: true,
                            val: body.daily_forecast2[i].day.pop
                        });
                        idx++;
                        if (idx === 8) break;
                    }
                    if (body.daily_forecast2[i].night) {
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.date', {
                            ack: true,
                            val: time2date(new Date(body.daily_forecast2[i].night.fcst_valid_local))
                        });
                        let iconId = parseInt(body.daily_forecast2[i].night.icon_code, 10);
                        if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                            iconId = body.daily_forecast2[i].night.icon_code;
                        }
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.icon', {
                            ack: true,
                            val: iconId
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.iconURL', {
                            ack: true,
                            val: handleIconUrl(body.daily_forecast2[i].night.icon_code)
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.title', {
                            ack: true,
                            val: body.daily_forecast2[i].night.daypart_name
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.state', {
                            ack: true,
                            val: body.daily_forecast2[i].night.narrative
                        });
                        await adapter.setStateAsync('forecastPeriod.' + idx + 'p.precipitationChance', {
                            ack: true,
                            val: body.daily_forecast2[i].night.pop
                        });
                        idx++;
                        if (idx === 8) break;
                    }

                }
                catch (error) {
                    adapter.log.error('exception in : body.daily_forecast2' + error);
                }
            }
        }
    }

    if (adapter.config.forecast_periods) {
        //next 4 days
        if (body.daily_forecast) {
            for (let i = 0; i < 4; i++) {
                try {
                    await adapter.setStateAsync('forecast.' + i + 'd.date', {
                        ack: true,
                        val: time2date(new Date(body.daily_forecast.validTimeLocal[i]))
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.tempMax', {
                        ack: true,
                        val: body.daily_forecast.temperatureMax[i]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.tempMin', {
                        ack: true,
                        val: body.daily_forecast.temperatureMin[i]
                    });
                    let iconId = parseInt(body.daily_forecast.daypart[0].iconCode[i * 2], 10);
                    if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                        iconId = body.daily_forecast.daypart[0].iconCode[i * 2];
                    }
                    await adapter.setStateAsync('forecast.' + i + 'd.icon', {
                        ack: true,
                        val: iconId
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.state', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].narrative[i * 2]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.iconURL', {
                        ack: true,
                        val: handleIconUrl(body.daily_forecast.daypart[0].iconCode[i * 2])
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationChance', {
                        ack: true,
                        val: Math.max(body.daily_forecast.daypart[0].precipChance[i * 2], body.daily_forecast.daypart[0].precipChance[1 + (i * 2)])
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationAllDay', {
                        ack: true,
                        val: body.daily_forecast.qpf[i]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationDay', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].qpf[i * 2]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationNight', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].qpf[1 + (i * 2)]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowAllDay', {
                        ack: true,
                        val: body.daily_forecast.qpfSnow[i]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowDay', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].qpfSnow[i * 2]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowNight', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].qpfSnow[1 + (i * 2)]
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.windSpeedMax', {
                        ack: true,
                        val: Math.max(body.daily_forecast.daypart[0].windSpeed[i * 2], body.daily_forecast.daypart[0].windSpeed[1 + (i * 2)])
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDirectionMax', {
                        ack: true,
                        val: Math.max(body.daily_forecast.daypart[0].windDirection[i * 2], body.daily_forecast.daypart[0].windDirection[1 + (i * 2)])
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDegreesMax', {
                        ack: true,
                        val: null
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.windSpeed', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].windSpeed[i * 2]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDirection', {
                        ack: true,
                        val: windDirections[Math.floor((body.daily_forecast.daypart[0].windDirection[i * 2] + 11.25) / 22.5)]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDegrees', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].windDirection[i * 2]
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.humidity', {
                        ack: true,
                        val: body.daily_forecast.daypart[0].relativeHumidity[i * 2]
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.humidityMax', {
                        ack: true,
                        val: Math.max(body.daily_forecast.daypart[0].relativeHumidity[i * 2], body.daily_forecast.daypart[0].relativeHumidity[1 + (i * 2)])
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.humidityMin', {
                        ack: true,
                        val: Math.min(body.daily_forecast.daypart[0].relativeHumidity[i * 2], body.daily_forecast.daypart[0].relativeHumidity[1 + (i * 2)])
                    });
                }
                catch (error) {
                    adapter.log.error('exception in daily forecast data ' + error);
                }
            }
        }
        else if (body.daily_forecast2) {
            for (let i = 0; i < 4; i++) {
                try {
                    await adapter.setStateAsync('forecast.' + i + 'd.date', {
                        ack: true,
                        val: time2date(new Date(body.daily_forecast2[i].fcst_valid_local))
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.tempMax', {
                        ack: true,
                        val: body.daily_forecast2[i].max_temp
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.tempMin', {
                        ack: true,
                        val: body.daily_forecast2[i].min_temp
                    });
                    let iconId = parseInt(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.icon_code : body.daily_forecast2[i].night.icon_code, 10);
                    if (isNaN(iconId)) { // accept that for the case it is not only numbers to get feedback
                        iconId = body.daily_forecast2[i].day ? body.daily_forecast2[i].day.icon_code : body.daily_forecast2[i].night.icon_code;
                    }
                    await adapter.setStateAsync('forecast.' + i + 'd.icon', {
                        ack: true,
                        val: iconId
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.state', {
                        ack: true,
                        val: body.daily_forecast2[i].narrative
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.iconURL', {
                        ack: true,
                        val: handleIconUrl(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.icon_code : body.daily_forecast2[i].night.icon_code)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationChance', {
                        ack: true,
                        val: Math.max(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.pop : 0, body.daily_forecast2[i].night.pop)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationAllDay', {
                        ack: true,
                        val: body.daily_forecast2[i].qpf
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationDay', {
                        ack: true,
                        val: body.daily_forecast2[i].day ? body.daily_forecast2[i].day.qpf : null
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.precipitationNight', {
                        ack: true,
                        val: body.daily_forecast2[i].night.qpf
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowAllDay', {
                        ack: true,
                        val: body.daily_forecast2[i].snow_qpf
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowDay', {
                        ack: true,
                        val: body.daily_forecast2[i].day ? body.daily_forecast2[i].day.snow_qpf : null
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.snowNight', {
                        ack: true,
                        val: body.daily_forecast2[i].night.snow_qpf
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.windSpeedMax', {
                        ack: true,
                        val: Math.max(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.wspd : 0, body.daily_forecast2[i].night.wspd)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDirectionMax', {
                        ack: true,
                        val: Math.max(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.wdir : 0, body.daily_forecast2[i].night.wdir)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDegreesMax', {
                        ack: true,
                        val: null
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.windSpeed', {
                        ack: true,
                        val: body.daily_forecast2[i].day ? body.daily_forecast2[i].day.wspd : body.daily_forecast2[i].night.wspd
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDirection', {
                        ack: true,
                        val: body.daily_forecast2[i].day ? body.daily_forecast2[i].day.wdir : body.daily_forecast2[i].night.wdir
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.windDegrees', {
                        ack: true,
                        val: null
                    });

                    await adapter.setStateAsync('forecast.' + i + 'd.humidity', {
                        ack: true,
                        val: body.daily_forecast2[i].day ? body.daily_forecast2[i].day.rh : body.daily_forecast2[i].night.rh
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.humidityMax', {
                        ack: true,
                        val: Math.max(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.rh : 0, body.daily_forecast2[i].night.rh)
                    });
                    await adapter.setStateAsync('forecast.' + i + 'd.humidityMin', {
                        ack: true,
                        val: Math.min(body.daily_forecast2[i].day ? body.daily_forecast2[i].day.rh : 100, body.daily_forecast2[i].night.rh)
                    });
                }
                catch (error) {
                    adapter.log.error('exception in daily forecast data ' + error);
                }
            }
        }
    }

    // next 36 hours
    if (adapter.config.forecast_hourly) {
        if (body.hourly_forecast) {
            for (let i = 0; i < 36; i++) {
                try {
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.time', {
                        ack: true,
                        val: new Date(body.hourly_forecast.validTimeUtc[i] * 1000).toString()
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.temp', {
                        ack: true,
                        val: body.hourly_forecast.temperature[i]
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.fctcode', {
                        ack: true,
                        val: null
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.sky', {
                        ack: true,
                        val: body.hourly_forecast.cloudCover[i]
                    }); //?
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.windSpeed', {
                        ack: true,
                        val: body.hourly_forecast.windSpeed[i]
                    }); // windspeed in kmh
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.windDirection', {
                        ack: true,
                        val: body.hourly_forecast.windDirection[i]
                    }); //wind dir in degrees
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.uv', {
                        ack: true,
                        val: body.hourly_forecast.uvIndex[i]
                    }); //UV Index -> wikipedia
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.humidity', {
                        ack: true,
                        val: body.hourly_forecast.relativeHumidity[i]
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.heatIndex', {
                        ack: true,
                        val: body.hourly_forecast.temperatureHeatIndex[i]
                    }); // -> wikipedia
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.feelsLike', {
                        ack: true,
                        val: body.hourly_forecast.temperatureFeelsLike[i]
                    }); // -> wikipedia
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.precipitation', {
                        ack: true,
                        val: body.hourly_forecast.qpf[i]
                    }); // Quantitative precipitation forecast
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.snow', {
                        ack: true,
                        val: body.hourly_forecast.qpfSnow[i]
                    });
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.precipitationChance', {
                        ack: true,
                        val: body.hourly_forecast.precipChance[i]
                    }); // probability of Precipitation
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.mslp', {
                        ack: true,
                        val: body.hourly_forecast.pressureMeanSeaLevel[i]
                    }); // mean sea level pressure
                    await adapter.setStateAsync('forecastHourly.' + i + 'h.visibility', {
                        ack: true,
                        val: parseFloat(body.hourly_forecast.visibility[i])
                    });

                    qpfMax += body.hourly_forecast.qpf[i];
                    uviSum += body.hourly_forecast.uvIndex[i];
                    if (body.hourly_forecast.precipChance[i] > popMax) {
                        popMax = body.hourly_forecast.precipChance[i];
                    }

                    // 6h
                    if (i === 5) {
                        await adapter.setStateAsync('forecastHourly.6h.sum.precipitation', {ack: true, val: qpfMax});
                        await adapter.setStateAsync('forecastHourly.6h.sum.precipitationChance', {ack: true, val: popMax});
                        await adapter.setStateAsync('forecastHourly.6h.sum.uv', {ack: true, val: uviSum / 6});
                    }
                    // 12h
                    if (i === 11) {
                        await adapter.setStateAsync('forecastHourly.12h.sum.precipitation', {ack: true, val: qpfMax});
                        await adapter.setStateAsync('forecastHourly.12h.sum.precipitationChance', {ack: true, val: popMax});
                        await adapter.setStateAsync('forecastHourly.12h.sum.uv', {ack: true, val: uviSum / 12});
                    }
                    // 24h
                    if (i === 23) {
                        await adapter.setStateAsync('forecastHourly.24h.sum.precipitation', {ack: true, val: qpfMax});
                        await adapter.setStateAsync('forecastHourly.24h.sum.precipitationChance', {ack: true, val: popMax});
                        await adapter.setStateAsync('forecastHourly.24h.sum.uv', {ack: true, val: uviSum / 24});
                    }
                } catch (error) {
                    adapter.log.error('Could not parse hourly Forecast-Data: ' + error);
                }
            }

            adapter.log.debug('all forecast values set');
        }

        else {
            adapter.log.error('No forecast data found in response');
        }
    }

    cb && cb();
}

function getLegacyWuData(cb) {
    adapter.log.debug('Use legacy API Key ' + pwsStationKey);
    let url = 'http://api.wunderground.com/api/' + encodeURIComponent(pwsStationKey);

    if (adapter.config.forecast_periods_txt || adapter.config.forecast_periods) {
        url += '/forecast';
    }

    if (adapter.config.forecast_hourly) {
        url += '/hourly';
    }

    if (adapter.config.current) {
        url += '/conditions';
    }

    url += `/units:${nonMetric ? 'e' : 'm'}`;

    url += '/lang:' + encodeURIComponent(adapter.config.language);

    if (adapter.config.station.length > 2) {
        url += '/q/pws:' + encodeURIComponent(adapter.config.station);
    } else {
        url += '/q/' + encodeURIComponent(adapter.config.location);
    }
    url += '.json';

    if (adapter.config.location.match(/^file:/)) {
        adapter.log.debug('read local WU file: ' + adapter.config.location);
        return parseLegacyResult(JSON.parse(require('fs').readFileSync(adapter.config.location.substring(7)).toString('utf8')), cb);
    }
    adapter.log.debug('get WU legacy data: ' + url);

    axios.get(url, {
        headers: requestHeaders,
        timeout: 15000,
        validateStatus: status => status === 200
    })
        .then(response => {
            if (stopInProgress) {
                return;
            }
            let body = response.data;
            if (body && body.response && body.response.error) {
                adapter.log.error(`Error: ${typeof body.response.error === 'object' ? body.response.error.description || JSON.stringify(body.response.error) : body.response.error}, Resetting Station Key`);
                pwsStationKey = '';
                errorCounter++;
                setImmediate(() => getKeysAndData(cb));
            } else {
                parseLegacyResult(body, cb);
            }
        })
        .catch(error => {
            if (error.response && error.response.status === 401) {
                adapter.log.info('Key rejected, resetting legacy key and trying again ...');
                pwsStationKey = '';

                errorCounter++;
                setImmediate(() => getKeysAndData(cb));
            } else {
                // ERROR
                adapter.log.error(`Unable to get PWS dashboard script: ${error.response ? error.response.statusCode : '--'}/${error.response && error.response.data ? JSON.stringify(error.response.data) : JSON.stringify(error)}`);
                return cb && cb();
            }
        });
}

function modifyExtractedUrl(url) {
    url = url || '';
    url = url.replace(/(units=)(.{1})/,'$1' + (nonMetric ? 'e' : 'm'));
    url = url.replace(/(language=)([a-zA-Z\-]{5})/,'$1' + encodeURIComponent(lang));
    if (url.includes('/v2/') && !url.includes('numericPrecision=')) {
        url = url.replace('?', '?numericPrecision=decimal&');
    }
    return url;
}

function getNewWuDataCurrentObservations(cb) {
    adapter.log.debug('Use new API Key ' + newWebKey);
    // always get current because we need the station coordinates

    const weatherData = {};

    let url;
    if (adapter.config.station) {
        const usedKey = adapter.config.current ? (officialApiKey || newWebKey) : newWebKey;
        url = `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(adapter.config.station)}&format=json&units=${nonMetric ? 'e' : 'm'}&numericPrecision=decimal&apiKey=${usedKey}`;
    } else {
        url = modifyExtractedUrl(currentObservationUrl);
    }
    adapter.log.debug('get current observation data: ' + url);

    axios.get(url, {
        headers: requestHeaders,
        timeout: 15000,
        validateStatus: status => status === 200
    })
        .then(response => {
            if (stopInProgress) {
                return;
            }
            let body = response.data;
            if (!body || !body.observations) {
                adapter.log.error('no observations in response from ' + url);
            } else {
                weatherData.current_observation = body.observations[0];
            }
            cb && cb(weatherData);
        })
        .catch(error => {
            if (error.response && error.response.status === 401) {
                if (officialApiKey) {
                    adapter.log.error('Please check your PWS Owner Key! Using key extracted from web page for now!');
                    officialApiKey = '';
                } else {
                    adapter.log.info('Key rejected, resetting web-key and trying again');
                    newWebKey = '';
                }
                errorCounter++;
                setImmediate(() => getKeysAndData(cb));
            } else {
                // ERROR
                adapter.log.error(`WUnderground reported an error: ${error.response ? error.response.statusCode : '--'}/${error.response && error.response.data ? JSON.stringify(error.response.data) : JSON.stringify(error)}`);
                return cb && cb(weatherData);
            }
        });
}

function getNewWuDataDailyForecast(weatherData, cb) {
    weatherData = weatherData || {};
    if (adapter.config.forecast_periods_txt || adapter.config.forecast_periods) {
        let url;
        if (adapter.config.station && officialApiKey && weatherData.current_observation && weatherData.current_observation.lon !== undefined && weatherData.current_observation.lat !== undefined ) {
            // https://api.weather.com/v3/wx/forecast/daily/5day?geocode=49.03578568,8.34588718&language=de&format=json&units=m&apiKey=712eb8d021404624aeb8d021402624d6
            url = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${encodeURIComponent(weatherData.current_observation.lat + ',' + weatherData.current_observation.lon)}&language=${lang}&format=json&units=${nonMetric ? 'e' : 'm'}&apiKey=${officialApiKey || newWebKey}`;
            if (weatherData.current_observation.lat === 0 && weatherData.current_observation.lon === 0) {
                adapter.log.info('Location seems invalid (0,0), please check the stateion-id/city setting!');
            }
        } else {
            url = modifyExtractedUrl(forecastDailyUrl);
            url = url.replace(/\/[0-9]+day/,'/5day');
        }
        adapter.log.debug('get daily forecast data: ' + url);

        axios.get(url, {
            headers: requestHeaders,
            timeout: 15000,
            validateStatus: status => status === 200
        })
            .then(response => {
                if (stopInProgress) {
                    return;
                }
                let body = response.data;
                if (!body || !body.dayOfWeek) {
                    if (body && body.forecasts) {
                        weatherData.daily_forecast2 = body.forecasts;
                    }
                    else {
                        adapter.log.error('no daily forecast in response from ' + url);
                    }
                } else {
                    weatherData.daily_forecast = body;
                }
            })
            .catch(error => {
                if (error.response && error.response.status === 401) {
                    if (officialApiKey) {
                        adapter.log.error('Please check your PWS Owner Key! Using key extracted from webpage for now!');
                        officialApiKey = '';
                    } else {
                        adapter.log.info('Key rejected, resetting webkey and trying again');
                        newWebKey = '';
                    }
                    errorCounter++;
                    setImmediate(() => getKeysAndData(cb));
                } else {
                    // ERROR
                    adapter.log.error(`WUnderground reported an error: ${error.response ? error.response.statusCode : '--'}/${error.response && error.response.data ? JSON.stringify(error.response.data) : JSON.stringify(error)}`);
                    return cb && cb(weatherData);
                }
            });
    } else {
        cb && cb(weatherData);
    }
}

function getNewWuDataHourlyForcast(weatherData, cb) {
    weatherData = weatherData || {};
    if (adapter.config.forecast_hourly) {
        let url = modifyExtractedUrl(forecastHourlyUrl);
        url = url.replace(/\/[0-9]+hour/,'/48hour');
        adapter.log.debug('get hourly forecast data: ' + url);

        axios.get(url, {
            headers: requestHeaders,
            timeout: 15000,
            validateStatus: status => status === 200
        })
            .then(response => {
                if (stopInProgress) {
                    return;
                }
                let body = response.data;
                try {
                    weatherData.hourly_forecast = body;

                } catch (e) {
                    adapter.log.error('no hourly forecast in response from ' + url);
                }
            })
            .catch(error => {
                if (error.response && error.response.status === 401) {
                    if (officialApiKey) {
                        adapter.log.error('Please check your PWS Owner Key! Using key extracted from webpage for now!');
                        officialApiKey = '';
                    } else {
                        adapter.log.info('Key rejected, resetting webkey and trying again');
                        newWebKey = '';
                    }
                    errorCounter++;
                    setImmediate(() => getKeysAndData(cb));
                } else {
                    // ERROR
                    adapter.log.error(`WUnderground reported an error: ${error.response ? error.response.statusCode : '--'}/${error.response && error.response.data ? JSON.stringify(error.response.data) : JSON.stringify(error)}`);
                    return cb && cb(weatherData);
                }
            });
    } else {
        cb && cb(weatherData);
    }
}

async function checkWeatherVariables() {
    let id;
    if (adapter.config.current) {
        adapter.log.debug('init conditions objects');
        await adapter.setObjectNotExistsAsync('forecast', {
            type: 'device',
            role: 'forecast',
            common: {
                name: 'Forecast for next 4 days days and current conditions'
            },
            native: {location: adapter.config.location}
        });
        await adapter.setObjectNotExistsAsync('forecast.current', {
            type: 'channel',
            common: {
                name: 'Current conditions',
                role: 'weather'
            },
            native: {location: adapter.config.location}
        });

        await adapter.setObjectNotExistsAsync('forecast.current.displayLocationFull', {
            type: 'state',
            common: {
                name: 'Display location full name',
                role: 'location',
                type: 'string'
            },
            native: {id: 'current_observation.display_location.full'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.displayLocationLatitude', {
            type: 'state',
            common: {
                name: 'Display location latitude',
                role: 'value.gps.latitude',
                type: 'number',
                unit: '°',
                read: true,
                write: false
            },
            native: {id: 'current_observation.display_location.latitude'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.displayLocationLongitude', {
            type: 'state',
            common: {
                name: 'Display location longitude',
                role: 'value.gps.longitude',
                type: 'number',
                unit: '°',
                read: true,
                write: false
            },
            native: {id: 'current_observation.display_location.longitude'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.displayLocationElevation', {
            type: 'state',
            common: {
                name: 'Display location elevation',
                role: 'value.gps.elevation',
                type: 'number',
                unit: 'm',
                read: true,
                write: false
            },
            native: {id: 'current_observation.display_location.elevation'}
        });

        await adapter.setObjectNotExistsAsync('forecast.current.observationLocationFull', {
            type: 'state',
            common: {
                name: 'Observation location full name',
                role: 'location',
                type: 'string'
            },
            native: {id: 'current_observation.observation_location.full'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.observationLocationLatitude', {
            type: 'state',
            common: {
                name: 'Observation location latitude',
                role: 'value.gps.latitude',
                type: 'number',
                unit: '°',
                read: true,
                write: false
            },
            native: {id: 'current_observation.observation_location.latitude'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.observationLocationLongitude', {
            type: 'state',
            common: {
                name: 'Observation location longitude',
                role: 'value.gps.longitude',
                type: 'number',
                unit: '°',
                read: true,
                write: false
            },
            native: {id: 'current_observation.observation_location.longitude'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.observationLocationElevation', {
            type: 'state',
            common: {
                name: 'Observation location elevation',
                role: 'value.gps.elevation',
                type: 'number',
                unit: nonMetric ? 'ft': 'm',
                read: true,
                write: false
            },
            native: {id: 'current_observation.observation_location.elevation'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.observationLocationStationID', {
            type: 'state',
            common: {name: 'WU station ID', role: 'state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.observation_location.station_id'}
        });

        await adapter.setObjectNotExistsAsync('forecast.current.localTimeRFC822', {
            type: 'state',
            common: {name: 'Local time (rfc822)', role: 'state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.local_time_rfc822'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.observationTimeRFC822', {
            type: 'state',
            common: {name: 'Observation time (rfc822)', role: 'state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.observation_time_rfc822'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.observationTime', {
            type: 'state',
            common: {name: 'Observation time (rfc822)', role: 'date', type: 'string', read: true, write: false},
            native: {id: 'current_observation.local_epoch'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.weather', {
            type: 'state',
            common: {name: 'Weather (engl.)', role: 'weather.state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.weather'}
        });
        if (nonMetric) {
            await adapter.setObjectNotExistsAsync('forecast.current.temp', {
                type: 'state',
                common: {
                    name: 'Temperature',
                    role: 'value.temperature',
                    type: 'number',
                    unit: '°F',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.temp_f'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.dewPoint', {
                type: 'state',
                common: {
                    name: 'Dewpoint',
                    role: 'value.temperature.dewpoint',
                    type: 'number',
                    unit: '°F',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.dewpoint_f'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.windChill', {
                type: 'state',
                common: {
                    name: 'Windchill',
                    role: 'value.temperature.windchill',
                    type: 'number',
                    unit: '°F',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.windchill_f'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.feelsLike', {
                type: 'state',
                common: {
                    name: 'Temperature feels like',
                    role: 'value.temperature.feelslike',
                    type: 'number',
                    unit: '°F',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.feelslike_f'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.visibility', {
                type: 'state',
                common: {
                    name: 'Visibility',
                    role: 'value.distance.visibility',
                    type: 'number',
                    unit: 'mi',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.visibility_mi'}
            });
        } else {
            await adapter.setObjectNotExistsAsync('forecast.current.temp', {
                type: 'state',
                common: {
                    name: 'Temperature',
                    role: 'value.temperature',
                    type: 'number',
                    unit: '°C',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.temp_c'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.dewPoint', {
                type: 'state',
                common: {
                    name: 'Dewpoint',
                    role: 'value.temperature.dewpoint',
                    type: 'number',
                    unit: '°C',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.dewpoint_c'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.windChill', {
                type: 'state',
                common: {
                    name: 'Windchill',
                    role: 'value.temperature.windchill',
                    type: 'number',
                    unit: '°C',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.windchill_c'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.feelsLike', {
                type: 'state',
                common: {
                    name: 'Temperature feels like',
                    role: 'value.temperature.feelslike',
                    type: 'number',
                    unit: '°C',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.feelslike_c'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.visibility', {
                type: 'state',
                common: {
                    name: 'Visibility',
                    role: 'value.distance.visibility',
                    type: 'number',
                    unit: 'km',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.visibility_km'}
            });
        }

        await adapter.setObjectNotExistsAsync('forecast.current.relativeHumidity', {
            type: 'state',
            common: {
                name: 'Relative humidity',
                role: 'value.humidity',
                type: 'number',
                unit: '%',
                read: true,
                write: false
            },
            native: {id: 'current_observation.relative_humidity'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.windDegrees', {
            type: 'state',
            common: {
                name: 'Wind direction Degrees',
                role: 'value.direction.wind',
                type: 'number',
                unit: '°',
                read: true,
                write: false
            },
            native: {id: 'current_observation.wind_degrees'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.windDirection', {
            type: 'state',
            common: {
                name: 'Wind direction',
                role: 'value.direction.wind',
                type: 'string',
                unit: '',
                read: true,
                write: false
            },
            native: {id: 'current_observation.wind_degrees'}
        });

        if (nonMetric) {
            await adapter.setObjectNotExistsAsync('forecast.current.wind', {
                type: 'state',
                common: {
                    name: 'Wind speed',
                    role: 'value.speed.wind',
                    type: 'number',
                    unit: 'm/h',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.wind_mph'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.windGust', {
                type: 'state',
                common: {
                    name: 'Wind gust',
                    role: 'value.speed.wind.gust',
                    type: 'number',
                    unit: 'm/h',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.wind_gust_mph'}
            });
        } else {
            await adapter.setObjectNotExistsAsync('forecast.current.wind', {
                type: 'state',
                common: {
                    name: 'Wind speed',
                    role: 'value.speed.wind',
                    type: 'number',
                    unit: 'km/h',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.wind_kph'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.windGust', {
                type: 'state',
                common: {
                    name: 'Wind gust',
                    role: 'value.speed.wind.gust',
                    type: 'number',
                    unit: 'km/h',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.wind_gust_kph'}
            });
        }

        await adapter.setObjectNotExistsAsync('forecast.current.pressure', { //PDE
            type: 'state',
            common: {
                name: 'Air pressure (mbar)',
                role: 'value.pressure',
                type: 'number',
                unit: 'mbar',
                read: true,
                write: false
            },
            native: {id: 'current_observation.pressure_mb'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.solarRadiation', {
            type: 'state',
            common: {
                name: 'Solar radiation',
                role: 'value.radiation',
                type: 'number',
                unit: 'w/m2',
                read: true,
                write: false
            },
            native: {id: 'current_observation.solarradiation'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.UV', {
            type: 'state',
            common: {name: 'UV-Index', role: 'value.uv', type: 'number', read: true, write: false},
            native: {id: 'current.UV'}
        });
        if (nonMetric) {
            await adapter.setObjectNotExistsAsync('forecast.current.precipitationHour', {
                type: 'state',
                common: {
                    name: 'Precipitation (last 1h)',
                    role: 'value.precipitation.hour',
                    type: 'number',
                    unit: 'in',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.precip_1hr_in'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.precipitationDay', {
                type: 'state',
                common: {
                    name: 'Precipitation (today)',
                    role: 'value.precipitation.today',
                    type: 'number',
                    unit: 'in',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.precip_today_in'}
            });
        } else {
            await adapter.setObjectNotExistsAsync('forecast.current.precipitationHour', {
                type: 'state',
                common: {
                    name: 'Precipitation (last 1h)',
                    role: 'value.precipitation.hour',
                    type: 'number',
                    unit: 'mm',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.precip_1hr_metric'}
            });
            await adapter.setObjectNotExistsAsync('forecast.current.precipitationDay', {
                type: 'state',
                common: {
                    name: 'Precipitation (today)',
                    role: 'value.precipitation.today',
                    type: 'number',
                    unit: 'mm',
                    read: true,
                    write: false
                },
                native: {id: 'current_observation.precip_today_metric'}
            });

        }
        await adapter.setObjectNotExistsAsync('forecast.current.iconURL', {
            type: 'state',
            common: {
                name: 'URL to current weather icon',
                role: 'weather.icon',
                type: 'number',
                read: true,
                write: false
            },
            native: {id: 'current_observation.icon_url'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.forecastURL', {
            type: 'state',
            common: {
                name: 'URL to wu-forecast page',
                role: 'weather.chart.url.forecast',
                type: 'string',
                read: true,
                write: false
            },
            native: {id: 'current_observation.forecast_url'}
        });
        await adapter.setObjectNotExistsAsync('forecast.current.historyURL', {
            type: 'state',
            common: {
                name: 'URL to wu-history page',
                role: 'weather.chart.url',
                type: 'string',
                read: true,
                write: false
            },
            native: {id: 'current_observation.history_url'}
        });
    }

    adapter.log.debug('init forecast objects');

    if (adapter.config.forecast_periods_txt) {
        await adapter.setObjectNotExistsAsync('forecastPeriod', {
            type: 'device',
            role: 'forecast',
            common: {name: 'next 8 day / night periods forecast with icon and text'},
            native: {location: adapter.config.location}
        });

        for (let d = 0; d < 8; d++) {
            id = 'forecastPeriod.' + d + 'p.';
            await adapter.setObjectNotExistsAsync('forecastPeriod.' + d + 'p', {
                type: 'channel',
                role: 'weather.forecast.' + d,
                common: {name: 'in ' + d + 'periods'},
                native: {location: adapter.config.location}
            });
            await adapter.setObjectNotExistsAsync(id + 'date', {
                type: 'state',
                common: {name: 'forecast for', type: 'string', role: 'date.forecast.' + d, read: true, write: false},
                native: {id: id + 'period'}
            });
            await adapter.setObjectNotExistsAsync(id + 'icon', {
                type: 'state',
                common: {
                    name: 'icon',
                    type: 'number',
                    role: 'weather.icon.name.forecast.' + d,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon'}
            });
            await adapter.setObjectNotExistsAsync(id + 'iconURL', {
                type: 'state',
                common: {
                    name: 'icon URL',
                    type: 'string',
                    role: 'value.iconURL.forecast.' + d,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon_URL'}
            });
            await adapter.setObjectNotExistsAsync(id + 'title', {
                type: 'state',
                common: {name: 'title', type: 'string', role: 'weather.title.forecast.' + d, read: true, write: false},
                native: {id: id + 'title'}
            });
            await adapter.setObjectNotExistsAsync(id + 'state', {
                type: 'state',
                common: {name: 'state', type: 'string', role: 'weather.state.forecast.' + d, read: true, write: false},
                native: {id: id + 'fcttext'}
            });
            await adapter.setObjectNotExistsAsync(id + 'precipitationChance', {
                type: 'state',
                common: {
                    name: 'Precipitation chance',
                    type: 'number',
                    role: 'value.precipitation.forecast.' + d,
                    unit: '%',
                    read: true,
                    write: false
                },
                native: {id: id + 'pop'}
            });
        }
    }

    if (adapter.config.forecast_periods) {
        await adapter.setObjectNotExistsAsync('forecast', {
            type: 'device',
            role: 'forecast',
            common: {name: 'Forecast for next 4 days days and current conditions'},
            native: {location: adapter.config.location}
        });

        for (let p = 0; p < 4; p++) {
            id = 'forecast.' + p + 'd.';
            await adapter.setObjectNotExistsAsync('forecast.' + p + 'd', {
                type: 'channel',
                role: 'forecast',
                common: {name: 'in ' + p + 'days'},
                native: {location: adapter.config.location}
            });
            await adapter.setObjectNotExistsAsync(id + 'date', {
                type: 'state',
                common: {name: 'forecast for', type: 'string', role: 'date.forecast.' + p, read: true, write: false},
                native: {id: id + 'date'}
            });
            if (nonMetric) {
                await adapter.setObjectNotExistsAsync(id + 'tempMax', {
                    type: 'state',
                    common: {
                        name: 'high temperature',
                        type: 'number',
                        unit: '°F',
                        role: 'value.temperature.max.forecast.' + p,
                        read: true,
                        write: false
                    },
                    native: {id: id + 'high.fahrenheit'}
                });
                await adapter.setObjectNotExistsAsync(id + 'tempMin', {
                    type: 'state',
                    common: {
                        name: 'low temperature',
                        type: 'number',
                        unit: '°F',
                        role: 'value.temperature.min.forecast.' + p,
                        read: true,
                        write: false
                    },
                    native: {id: id + 'low.fahrenheit'}
                });
                await adapter.setObjectNotExistsAsync(id + 'precipitationAllDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative precipitation all day forecast',
                        role: 'value.precipitation.today.forecast.' + p,
                        unit: 'in',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'qpf_allday.in'}
                });
                await adapter.setObjectNotExistsAsync(id + 'precipitationDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative precipitation day forecast',
                        role: 'value.precipitation.day.forecast.' + p,
                        unit: 'in',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'qpf_day.in'}
                });
                await adapter.setObjectNotExistsAsync(id + 'precipitationNight', {
                    type: 'state',
                    common: {
                        name: 'Quantitative precipitation night forecast',
                        role: 'value.precipitation.night.forecast.' + p,
                        unit: 'in',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'qpf.night'}
                });

                await adapter.setObjectNotExistsAsync(id + 'snowAllDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative snow all day forecast',
                        type: 'number',
                        role: 'value.snow.forecast.' + p,
                        unit: 'in',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'snow_allday.in'}
                });
                await adapter.setObjectNotExistsAsync(id + 'snowDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative snow day forecast',
                        role: 'value.snow.day.forecast.' + p,
                        type: 'number',
                        unit: 'in',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'snow_day.in'}
                });
                await adapter.setObjectNotExistsAsync(id + 'snowNight', {
                    type: 'state',
                    common: {
                        name: 'Quantitative snow night forecast',
                        role: 'value.snow.night.forecast.' + p,
                        type: 'number',
                        unit: 'in',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'snow_night.in'}
                });

                await adapter.setObjectNotExistsAsync(id + 'windSpeedMax', {
                    type: 'state',
                    common: {
                        name: 'max. wind speed',
                        role: 'value.speed.max.wind.forecast.' + p,
                        unit: 'm/h',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'maxwind.kph'}
                });
                await adapter.setObjectNotExistsAsync(id + 'windSpeed', {
                    type: 'state',
                    common: {
                        name: 'average wind speed',
                        role: 'value.speed.wind.forecast.' + p,
                        unit: 'm/h',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'avewind.mph'}
                });
            } else {
                await adapter.setObjectNotExistsAsync(id + 'tempMax', {
                    type: 'state',
                    common: {
                        name: 'high temperature',
                        type: 'number',
                        unit: '°C',
                        role: 'value.temperature.max.forecast.' + p,
                        read: true,
                        write: false
                    },
                    native: {id: id + 'high.celsius'}
                });
                await adapter.setObjectNotExistsAsync(id + 'tempMin', {
                    type: 'state',
                    common: {
                        name: 'low temperature',
                        type: 'number',
                        unit: '°C',
                        role: 'value.temperature.min.forecast.' + p,
                        read: true,
                        write: false
                    },
                    native: {id: id + 'low.celsius'}
                });
                await adapter.setObjectNotExistsAsync(id + 'precipitationAllDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative precipitation all day forecast',
                        role: 'value.precipitation.today.forecast.' + p,
                        unit: 'mm',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'qpf_allday.mm'}
                });
                await adapter.setObjectNotExistsAsync(id + 'precipitationDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative precipitation day forecast',
                        role: 'value.precipitation.day.forecast.' + p,
                        unit: 'mm',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'qpf_day.mm'}
                });
                await adapter.setObjectNotExistsAsync(id + 'precipitationNight', {
                    type: 'state',
                    common: {
                        name: 'Quantitative precipitation night forecast',
                        role: 'value.precipitation.night.forecast.' + p,
                        unit: 'mm',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'qpf_night.mm'}
                });

                await adapter.setObjectNotExistsAsync(id + 'snowAllDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative snow all day forecast',
                        type: 'number',
                        role: 'value.snow.forecast.' + p,
                        unit: 'cm',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'snow_allday.cm'}
                });
                await adapter.setObjectNotExistsAsync(id + 'snowDay', {
                    type: 'state',
                    common: {
                        name: 'Quantitative snow day forecast',
                        role: 'value.snow.day.forecast.' + p,
                        type: 'number',
                        unit: 'cm',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'snow_day.cm'}
                });
                await adapter.setObjectNotExistsAsync(id + 'snowNight', {
                    type: 'state',
                    common: {
                        name: 'Quantitative snow night forecast',
                        role: 'value.snow.night.forecast.' + p,
                        type: 'number',
                        unit: 'cm',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'snow_night.cm'}
                });

                await adapter.setObjectNotExistsAsync(id + 'windSpeedMax', {
                    type: 'state',
                    common: {
                        name: 'max. wind speed',
                        role: 'value.speed.max.wind.forecast.' + p,
                        unit: 'km/h',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'maxwind.kph'}
                });
                await adapter.setObjectNotExistsAsync(id + 'windSpeed', {
                    type: 'state',
                    common: {
                        name: 'average wind speed',
                        role: 'value.speed.wind.forecast.' + p,
                        unit: 'km/h',
                        type: 'number',
                        read: true,
                        write: false
                    },
                    native: {id: id + 'avewind.kph'}
                });
            }
            await adapter.setObjectNotExistsAsync(id + 'icon', {
                type: 'state',
                common: {
                    name: 'forecast icon',
                    type: 'number',
                    role: 'weather.icon.name.forecast.' + p,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon'}
            });
            await adapter.setObjectNotExistsAsync(id + 'state', {
                type: 'state',
                common: {
                    name: 'forecast state',
                    type: 'string',
                    role: 'weather.state.forecast.' + p,
                    read: true,
                    write: false
                },
                native: {id: id + 'state'}
            });
            await adapter.setObjectNotExistsAsync(id + 'iconURL', {
                type: 'state',
                common: {
                    name: 'forecast icon url',
                    type: 'string',
                    role: 'weather.icon.forecast.' + p,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon_url'}
            });
            await adapter.setObjectNotExistsAsync(id + 'precipitationChance', {
                type: 'state',
                common: {
                    name: 'Percentage of precipitation',
                    type: 'number',
                    role: 'value.precipitation.forecast.' + p,
                    unit: '%',
                    read: true,
                    write: false
                },
                native: {id: id + 'pop'}
            });

            await adapter.setObjectNotExistsAsync(id + 'windDirectionMax', {
                type: 'state',
                common: {
                    name: 'max. wind direction',
                    role: 'weather.direction.max.wind.forecast.' + p,
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'maxwind.dir'}
            });
            await adapter.setObjectNotExistsAsync(id + 'windDegreesMax', {
                type: 'state',
                common: {
                    name: 'max. wind direction',
                    role: 'value.direction.max.wind.forecast.' + p,
                    unit: '°',
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'maxwind.degrees'}
            });
            await adapter.setObjectNotExistsAsync(id + 'windDirection', {
                type: 'state',
                common: {
                    name: 'average wind direction',
                    role: 'weather.direction.wind.forecast.' + p,
                    type: 'string',
                    read: true,
                    write: false
                },
                native: {id: id + 'avewind.dir'}
            });
            await adapter.setObjectNotExistsAsync(id + 'windDegrees', {
                type: 'state',
                common: {
                    name: 'average wind direction degrees',
                    role: 'value.direction.wind.forecast.' + p,
                    unit: '°',
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'avewind.degrees'}
            });
            await adapter.setObjectNotExistsAsync(id + 'windDirection', {
                type: 'state',
                common: {
                    name: 'average wind direction',
                    role: 'value.direction.wind.forecast.' + p,
                    unit: '',
                    type: 'string',
                    read: true,
                    write: false
                },
                native: {id: id + 'avewind.direction'}
            });

            await adapter.setObjectNotExistsAsync(id + 'humidity', {
                type: 'state',
                common: {
                    name: 'average humidity',
                    role: 'value.humidity.forecast.' + p,
                    unit: '%',
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'avehumidity'}
            });
            await adapter.setObjectNotExistsAsync(id + 'humidityMax', {
                type: 'state',
                common: {
                    name: 'maximum humidity',
                    role: 'value.humidity.max.forecast.' + p,
                    unit: '%',
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'maxhumidity'}
            });
            await adapter.setObjectNotExistsAsync(id + 'humidityMin', {
                type: 'state',
                common: {
                    name: 'minimum humidity',
                    role: 'value.humidity.min.forecast.' + p,
                    unit: '%',
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'minhumidity'}
            });
        }
    }

    if (adapter.config.forecast_hourly) {
        await adapter.setObjectNotExistsAsync('forecastHourly', {
            type: 'device',
            role: 'forecast',
            common: {name: 'next 36h forecast'},
            native: {location: adapter.config.location}
        });

        for (let h = 0; h < 36; h++) {
            id = 'forecastHourly.' + h + 'h.';
            await adapter.setObjectNotExistsAsync('forecastHourly.' + h + 'h', {
                type: 'channel',
                role: 'forecast',
                common: {name: 'in ' + h + 'h'},
                native: {location: adapter.config.location}
            });
            await adapter.setObjectNotExistsAsync(id + 'time', {
                type: 'state',
                common: {name: 'forecast for', role: 'date', type: 'string', read: true, write: false},
                native: {id: id + 'time'}
            });
            await adapter.setObjectNotExistsAsync(id + 'temp', {
                type: 'state',
                common: {
                    name: 'Temperature',
                    type: 'number',
                    role: 'value.temperature',
                    unit: nonMetric ? '°F' : '°C',
                    read: true,
                    write: false
                },
                native: {id: id + 'temp'}
            });
            await adapter.setObjectNotExistsAsync(id + 'fctcode', {
                type: 'state',
                common: {name: 'forecast description code', type: 'number', read: true, write: false},
                native: {id: id + 'fctcode'}
            });
            await adapter.setObjectNotExistsAsync(id + 'sky', {
                type: 'state',
                common: {name: 'Sky (clear..covered)', type: 'number', unit: '%', role: 'value.clouds', read: true, write: false},
                native: {id: id + 'sky'}
            });
            await adapter.setObjectNotExistsAsync(id + 'windSpeed', {
                type: 'state',
                common: {name: 'Windspeed', type: 'number', role: 'value.wind', unit: nonMetric ? 'm/h' : 'km/h', read: true, write: false},
                native: {id: id + 'wspd'}
            });
            await adapter.setObjectNotExistsAsync(id + 'windDirection', {
                type: 'state',
                common: {
                    name: 'Wind direction',
                    type: 'number',
                    role: 'value.direction.wind',
                    unit: '°',
                    read: true,
                    write: false
                },
                native: {id: id + 'wdir'}
            });
            await adapter.setObjectNotExistsAsync(id + 'uv', {
                type: 'state',
                common: {name: 'UV Index (0..~10)', type: 'number', role: 'value.uv', read: true, write: false},
                native: {id: id + 'uvi'}
            });
            await adapter.setObjectNotExistsAsync(id + 'humidity', {
                type: 'state',
                common: {name: 'Humidity', type: 'number', role: 'value.humidity', unit: '%', read: true, write: false},
                native: {id: id + 'humidity'}
            });
            await adapter.setObjectNotExistsAsync(id + 'heatIndex', {
                type: 'state',
                common: {
                    name: 'Heat index',
                    type: 'number',
                    role: 'value.temperature',
                    unit: nonMetric ? '°F' : '°C',
                    read: true,
                    write: false
                },
                native: {id: id + 'heatindex.' + nonMetric ? 'metric' : 'english'}
            });
            await adapter.setObjectNotExistsAsync(id + 'feelsLike', {
                type: 'state',
                common: {
                    name: 'Feels like',
                    type: 'number',
                    role: 'value.temperature.feelslike',
                    unit: nonMetric ? '°F' : '°C',
                    read: true,
                    write: false
                },
                native: {id: id + 'feelslike.' + nonMetric ? 'metric' : 'english'}
            });
            await adapter.setObjectNotExistsAsync(id + 'precipitation', {
                type: 'state',
                common: {
                    name: 'Quantitative precipitation forecast',
                    type: 'number',
                    role: 'value.precipitation',
                    unit: nonMetric ? 'in' : 'mm',
                    read: true,
                    write: false
                },
                native: {id: id + 'qpf.' + nonMetric ? 'metric' : 'english'}
            });
            await adapter.setObjectNotExistsAsync(id + 'snow', {
                type: 'state',
                common: {
                    name: 'Snow precipitation',
                    type: 'number',
                    role: 'value.snow',
                    unit: nonMetric ? 'in' : 'cm',
                    read: true,
                    write: false
                },
                native: {id: id + 'snow.' + nonMetric ? 'metric' : 'english'}
            });
            await adapter.setObjectNotExistsAsync(id + 'precipitationChance', {
                type: 'state',
                common: {
                    name: 'Percentage of precipitation',
                    type: 'number',
                    role: 'value.rain',
                    unit: '%',
                    read: true,
                    write: false
                },
                native: {id: id + 'pop'}
            });
            await adapter.setObjectNotExistsAsync(id + 'mslp', {
                type: 'state',
                common: {
                    name: 'Mean sea level pressure',
                    type: 'number',
                    role: 'value.pressure',
                    unit: nonMetric ? 'inHg' : 'hPa',
                    read: true,
                    write: false
                },
                native: {id: id + 'mslp.' + nonMetric ? 'metric' : 'english'}
            });
            await adapter.setObjectNotExistsAsync(id + 'visibility', {
                type: 'state',
                common: {
                    name: 'Visibility',
                    type: 'number',
                    role: 'value.distance.visibility',
                    unit: nonMetric ? 'mi' : 'km',
                    read: true,
                    write: false
                },
                native: {id: id + 'visibility'}
            });

        }

        await adapter.setObjectNotExistsAsync('forecastHourly.6h.sum.precipitation', {
            type: 'state',
            common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: nonMetric ? 'in' : 'mm', read: true, write: false},
            native: {id: 'forecast.6h.sum.qpf.' + nonMetric ? 'metric' : 'english'}
        });
        await adapter.setObjectNotExistsAsync('forecastHourly.12h.sum.precipitation', {
            type: 'state',
            common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: nonMetric ? 'in' : 'mm', read: true, write: false},
            native: {id: 'forecast.12h.sum.qpf.' + nonMetric ? 'metric' : 'english'}
        });
        await adapter.setObjectNotExistsAsync('forecastHourly.24h.sum.precipitation', {
            type: 'state',
            common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: nonMetric ? 'in' : 'mm', read: true, write: false},
            native: {id: 'forecast.24h.sum.qpf.' + nonMetric ? 'metric' : 'english'}
        });

        await adapter.setObjectNotExistsAsync('forecastHourly.6h.sum.precipitationChance', {
            type: 'state',
            common: {
                name: 'max of precipitation chance',
                type: 'number',
                role: 'value.rain',
                unit: '%',
                read: true,
                write: false
            },
            native: {id: 'forecast.6h.sum.pop'}
        });
        await adapter.setObjectNotExistsAsync('forecastHourly.12h.sum.precipitationChance', {
            type: 'state',
            common: {
                name: 'max of precipitation chance',
                type: 'number',
                role: 'value.rain',
                unit: '%',
                read: true,
                write: false
            },
            native: {id: 'forecast.12h.sum.pop'}
        });
        await adapter.setObjectNotExistsAsync('forecastHourly.24h.sum.precipitationChance', {
            type: 'state',
            common: {
                name: 'max of precipitation chance',
                type: 'number',
                role: 'value.rain',
                unit: '%',
                read: true,
                write: false
            },
            native: {id: 'forecast.24h.sum.pop'}
        });

        await adapter.setObjectNotExistsAsync('forecastHourly.6h.sum.uv', {
            type: 'state',
            common: {name: 'avg. uvi', type: 'number', role: 'value.uv', read: true, write: false},
            native: {id: 'forecast.6h.sum.uvi'}
        });
        await adapter.setObjectNotExistsAsync('forecastHourly.12h.sum.uv', {
            type: 'state',
            common: {name: 'avg. uvi', type: 'number', role: 'value.uv', read: true, write: false},
            native: {id: 'forecast.12h.sum.uvi'}
        });
        await adapter.setObjectNotExistsAsync('forecastHourly.24h.sum.uv', {
            type: 'state',
            common: {name: 'avg. uvi', type: 'number', role: 'value.uv', read: true, write: false},
            native: {id: 'forecast.24h.sum.uvi'}
        });
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
