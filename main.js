/* jshint -W097 */
/* jshint strict: false */
/*jslint node: true */

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

const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const request = require('request');
//const iconv      = require('iconv-lite');

const adapter = utils.Adapter('weatherunderground');
const dictionary = require('./lib/words');
let lang = 'en';

function _(text) {
    if (!text) return '';

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

adapter.on('ready', () => {

    adapter.config.language = adapter.config.language || 'DL';

    switch (adapter.config.language) {
        case 'DL':
            lang = 'de';
            break;
        case 'EN':
            lang = 'en';
            break;
        case 'RU':
            lang = 'ru';
            break;
        case 'NL':
            lang = 'nl';
            break;
    }


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

    checkWeatherVariables();

    getApiKey(apikey => {
        getWuData(apikey, () => {
            setTimeout(() => adapter.stop(), 2000);
        });
    });

    // force terminate after 1min
    // don't know why it does not terminate by itself...
    setTimeout(() => {
        adapter.log.warn('force terminate');
        process.exit(0);
    }, 60000);
});

let nonMetric = false;

function handleIconUrl(original) {
    if (adapter.config.iconSet) {
        original = 'https://icons.wxug.com/i/c/' + adapter.config.iconSet + '/' + original.substring(original.lastIndexOf('/') + 1);
    } else
    if (adapter.config.custom_icon_base_url) {
        var pos = original.lastIndexOf('.');

        if (original.substring(pos + 1) !== adapter.config.custom_icon_format) {
            original = original.replace(/\.\w+$/, '.' + adapter.config.custom_icon_format);
        }

        original = adapter.config.custom_icon_base_url + original.substring(original.lastIndexOf('/') + 1);

    }
    return original;
}

function getApiKey(cb) {
    let apiKey;
    if (adapter.config.apikey.indexOf(',') !== -1) {
        adapter.setObjectNotExists('last_used_key', {
            type: 'state',
            common: {type: 'number', name: 'Last used API key', def: 0},
            native: {id: 'last_used_key'}
        }, () => {
            adapter.getState('last_used_key', (err, obj) => {
                let key = 0;
                if (err) {
                    adapter.log.error('Error: ' + err);
                }
                else if (obj) {
                    key = obj.val;
                }
                else {
                    key = 0;
                }
                if (key === undefined || key === null) key = 0;
                const keyArr = adapter.config.apikey.split(',');
                key += 1;
                if (key > keyArr.length - 1) key = 0;
                apiKey = keyArr[key].trim();
                cb(apiKey);
                adapter.setState('last_used_key', {val: key, ack: true})
            });
        });
    }
    else {
        apiKey = adapter.config.apikey;
        cb(apiKey);
    }
}

function parseResult(body, cb) {
    let qpfMax = 0;
    let popMax = 0;
    let uviSum = 0;

    if (adapter.config.current) {
        if (body.current_observation) {
            try {
                adapter.setState('forecast.current.displayLocationFull', {
                    ack: true,
                    val: body.current_observation.display_location.full
                });
                adapter.setState('forecast.current.displayLocationLatitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.display_location.latitude)
                });
                adapter.setState('forecast.current.displayLocationLongitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.display_location.longitude)
                });
                adapter.setState('forecast.current.displayLocationElevation', {
                    ack: true,
                    val: parseFloat(body.current_observation.display_location.elevation)
                });

                adapter.setState('forecast.current.observationLocationFull', {
                    ack: true,
                    val: body.current_observation.observation_location.full
                });
                adapter.setState('forecast.current.observationLocationLatitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.observation_location.latitude)
                });
                adapter.setState('forecast.current.observationLocationLongitude', {
                    ack: true,
                    val: parseFloat(body.current_observation.observation_location.longitude)
                });
                if (nonMetric) {
                    adapter.setState('forecast.current.observationLocationElevation', {
                        ack: true,
                        val: (parseFloat(body.current_observation.observation_location.elevation))
                    }); // ft
                } else {
                    adapter.setState('forecast.current.observationLocationElevation', {
                        ack: true,
                        val: (Math.round(parseFloat(body.current_observation.observation_location.elevation) * 0.3048) * 100) / 100
                    }); // convert ft to m
                }

                adapter.setState('forecast.current.observationLocationStationID', {
                    ack: true,
                    val: body.current_observation.station_id
                });
                adapter.setState('forecast.current.localTimeRFC822', {
                    ack: true,
                    val: body.current_observation.local_time_rfc822
                });
                adapter.setState('forecast.current.observationTimeRFC822', {
                    ack: true,
                    val: body.current_observation.observation_time_rfc822
                }); // PDE
                adapter.setState('forecast.current.observationTime', {
                    ack: true,
                    val: new Date(parseInt(body.current_observation.local_epoch, 10) * 1000).toLocaleString()
                }); // PDE

                adapter.setState('forecast.current.weather', {ack: true, val: body.current_observation.weather});
                if (nonMetric) {
                    adapter.setState('forecast.current.temp', {ack: true, val: parseFloat(body.current_observation.temp_f)});
                } else {
                    adapter.setState('forecast.current.temp', {ack: true, val: parseFloat(body.current_observation.temp_c)});
                }
                adapter.setState('forecast.current.relativeHumidity', {
                    ack: true,
                    val: parseFloat(body.current_observation.relative_humidity.replace('%', ''))
                });
                adapter.setState('forecast.current.windDegrees', {
                    ack: true,
                    val: parseFloat(body.current_observation.wind_degrees)
                });
                if (nonMetric) {
                    adapter.setState('forecast.current.wind', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_mph)
                    });
                    adapter.setState('forecast.current.windGust', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_gust_mph)
                    });
                } else {
                    adapter.setState('forecast.current.wind', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_kph)
                    });
                    adapter.setState('forecast.current.windGust', {
                        ack: true,
                        val: parseFloat(body.current_observation.wind_gust_kph)
                    });
                }

                adapter.setState('forecast.current.pressure', {
                    ack: true,
                    val: parseFloat(body.current_observation.pressure_mb)
                }); //PDE
                if (nonMetric) {
                    adapter.setState('forecast.current.dewPoint', {
                        ack: true,
                        val: body.current_observation.dewpoint_f === 'NA' ? null : parseFloat(body.current_observation.dewpoint_f)
                    });
                    adapter.setState('forecast.current.windChill', {
                        ack: true,
                        val: body.current_observation.windchill_f === 'NA' ? null : parseFloat(body.current_observation.windchill_f)
                    });
                    adapter.setState('forecast.current.feelsLike', {
                        ack: true,
                        val: body.current_observation.feelslike_f === 'NA' ? null : parseFloat(body.current_observation.feelslike_f)
                    });
                    adapter.setState('forecast.current.visibility', {
                        ack: true,
                        val: parseFloat(body.current_observation.visibility_mi)
                    });
                } else {
                    adapter.setState('forecast.current.dewPoint', {
                        ack: true,
                        val: body.current_observation.dewpoint_c === 'NA' ? null : parseFloat(body.current_observation.dewpoint_c)
                    });
                    adapter.setState('forecast.current.windChill', {
                        ack: true,
                        val: body.current_observation.windchill_c === 'NA' ? null : parseFloat(body.current_observation.windchill_c)
                    });
                    adapter.setState('forecast.current.feelsLike', {
                        ack: true,
                        val: body.current_observation.feelslike_c === 'NA' ? null : parseFloat(body.current_observation.feelslike_c)
                    });
                    adapter.setState('forecast.current.visibility', {
                        ack: true,
                        val: parseFloat(body.current_observation.visibility_km)
                    });
                }
                adapter.setState('forecast.current.solarRadiation', {
                    ack: true,
                    val: body.current_observation.solarradiation
                });
                adapter.setState('forecast.current.UV', {ack: true, val: parseFloat(body.current_observation.UV)});
                if (nonMetric) {
                    if (!isNaN(parseInt(body.current_observation.precip_1hr_in, 10))) {
                        adapter.setState('forecast.current.precipitationHour', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_1hr_in, 10)
                        });
                    }
                    if (!isNaN(parseInt(body.current_observation.precip_today_in, 10))) {
                        adapter.setState('forecast.current.precipitationDay', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_today_in, 10)
                        });
                    }
                } else {
                    if (!isNaN(parseInt(body.current_observation.precip_1hr_metric, 10))) {
                        adapter.setState('forecast.current.precipitationHour', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_1hr_metric, 10)
                        });
                    }
                    if (!isNaN(parseInt(body.current_observation.precip_today_metric, 10))) {
                        adapter.setState('forecast.current.precipitationDay', {
                            ack: true,
                            val: parseInt(body.current_observation.precip_today_metric, 10)
                        });
                    }
                }

                adapter.setState('forecast.current.iconURL', {
                    ack: true,
                    val: handleIconUrl(body.current_observation.icon_url)
                });
                adapter.setState('forecast.current.forecastURL', {
                    ack: true,
                    val: body.current_observation.forecast_url
                });
                adapter.setState('forecast.current.historyURL', {ack: true, val: body.current_observation.history_url});
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

                    adapter.setState('forecastPeriod.' + i + 'p.date', {
                        ack: true,
                        val: now.toLocaleDateString()
                    });
                    adapter.setState('forecastPeriod.' + i + 'p.icon', {
                        ack: true,
                        val: body.forecast.txt_forecast.forecastday[i].icon
                    });
                    adapter.setState('forecastPeriod.' + i + 'p.iconURL', {
                        ack: true,
                        val: handleIconUrl(body.forecast.txt_forecast.forecastday[i].icon_url)
                    });
                    adapter.setState('forecastPeriod.' + i + 'p.title', {
                        ack: true,
                        val: body.forecast.txt_forecast.forecastday[i].title
                    });
                    if (nonMetric) {
                        adapter.setState('forecastPeriod.' + i + 'p.state', {
                            ack: true,
                            val: body.forecast.txt_forecast.forecastday[i].fcttext
                        });
                    } else {
                        adapter.setState('forecastPeriod.' + i + 'p.state', {
                            ack: true,
                            val: body.forecast.txt_forecast.forecastday[i].fcttext_metric
                        });
                    }
                    adapter.setState('forecastPeriod.' + i + 'p.precipitationChance', {
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
        //adapter.log.debug('555');
        if (body.forecast && body.forecast.simpleforecast && body.forecast.simpleforecast.forecastday) {
            for (let i = 0; i < 4; i++) {
                if (!body.forecast.simpleforecast.forecastday[i]) continue;
                try {
                    adapter.setState('forecast.' + i + 'd.date', {
                        ack: true,
                        val: new Date(parseInt(body.forecast.simpleforecast.forecastday[i].date.epoch, 10) * 1000).toLocaleDateString()
                    });
                    adapter.setState('forecast.' + i + 'd.tempMax', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].high.fahrenheit : body.forecast.simpleforecast.forecastday[i].high.celsius
                    });
                    adapter.setState('forecast.' + i + 'd.tempMin', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].low.fahrenheit : body.forecast.simpleforecast.forecastday[i].low.celsius
                    });
                    adapter.setState('forecast.' + i + 'd.icon', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].icon
                    });
                    adapter.setState('forecast.' + i + 'd.state', {
                        ack: true,
                        val: _('state_' + body.forecast.simpleforecast.forecastday[i].icon)
                    });
                    adapter.setState('forecast.' + i + 'd.iconURL', {
                        ack: true,
                        val: handleIconUrl(body.forecast.simpleforecast.forecastday[i].icon_url)
                    });
                    adapter.setState('forecast.' + i + 'd.precipitationChance', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].pop
                    });
                    adapter.setState('forecast.' + i + 'd.precipitationAllDay', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].qpf_allday.in : body.forecast.simpleforecast.forecastday[i].qpf_allday.mm
                    });
                    adapter.setState('forecast.' + i + 'd.precipitationDay', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].qpf_day.in : body.forecast.simpleforecast.forecastday[i].qpf_day.mm
                    });
                    adapter.setState('forecast.' + i + 'd.precipitationNight', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].qpf_night.in : body.forecast.simpleforecast.forecastday[i].qpf_night.mm
                    });
                    adapter.setState('forecast.' + i + 'd.snowAllDay', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].snow_allday.in : body.forecast.simpleforecast.forecastday[i].snow_allday.cm
                    });
                    adapter.setState('forecast.' + i + 'd.snowDay', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].snow_day.in : body.forecast.simpleforecast.forecastday[i].snow_day.cm
                    });
                    adapter.setState('forecast.' + i + 'd.snowNight', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].snow_night.cm : body.forecast.simpleforecast.forecastday[i].snow_night.cm
                    });

                    adapter.setState('forecast.' + i + 'd.windSpeedMax', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].maxwind.mph : body.forecast.simpleforecast.forecastday[i].maxwind.kph
                    });
                    adapter.setState('forecast.' + i + 'd.windDirectionMax', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].maxwind.dir
                    });
                    adapter.setState('forecast.' + i + 'd.windDegreesMax', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].maxwind.degrees
                    });

                    adapter.setState('forecast.' + i + 'd.windSpeed', {
                        ack: true,
                        val: nonMetric ? body.forecast.simpleforecast.forecastday[i].avewind.mph : body.forecast.simpleforecast.forecastday[i].avewind.kph
                    });
                    adapter.setState('forecast.' + i + 'd.windDirection', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].avewind.dir
                    });
                    adapter.setState('forecast.' + i + 'd.windDegrees', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].avewind.degrees
                    });

                    adapter.setState('forecast.' + i + 'd.humidity', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].avehumidity
                    });
                    adapter.setState('forecast.' + i + 'd.humidityMax', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].maxhumidity
                    });
                    adapter.setState('forecast.' + i + 'd.humidityMin', {
                        ack: true,
                        val: body.forecast.simpleforecast.forecastday[i].minhumidity
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
                if (!body.hourly_forecast[i]) continue;
                try {
                    // see http://www.wunderground.com/weather/api/d/docs?d=resources/phrase-glossary for infos about properties and codes
                    adapter.setState('forecastHourly.' + i + 'h.time', {
                        ack: true,
                        val: new Date(parseInt(body.hourly_forecast[i].FCTTIME.epoch, 10) * 1000).toLocaleString()
                    });
                    adapter.setState('forecastHourly.' + i + 'h.temp', {
                        ack: true,
                        val: body.hourly_forecast[i].temp[type]
                    });
                    adapter.setState('forecastHourly.' + i + 'h.fctcode', {
                        ack: true,
                        val: body.hourly_forecast[i].fctcode
                    }); //forecast description number -> see link above
                    adapter.setState('forecastHourly.' + i + 'h.sky', {ack: true, val: body.hourly_forecast[i].sky}); //?
                    adapter.setState('forecastHourly.' + i + 'h.windSpeed', {
                        ack: true,
                        val: body.hourly_forecast[i].wspd[type]
                    }); // windspeed in kmh
                    adapter.setState('forecastHourly.' + i + 'h.windDirection', {
                        ack: true,
                        val: body.hourly_forecast[i].wdir.degrees
                    }); //wind dir in degrees
                    adapter.setState('forecastHourly.' + i + 'h.uv', {ack: true, val: body.hourly_forecast[i].uvi}); //UV Index -> wikipedia
                    adapter.setState('forecastHourly.' + i + 'h.humidity', {
                        ack: true,
                        val: body.hourly_forecast[i].humidity
                    });
                    adapter.setState('forecastHourly.' + i + 'h.heatIndex', {
                        ack: true,
                        val: body.hourly_forecast[i].heatindex[type]
                    }); // -> wikipedia
                    adapter.setState('forecastHourly.' + i + 'h.feelsLike', {
                        ack: true,
                        val: body.hourly_forecast[i].feelslike[type]
                    }); // -> wikipedia
                    adapter.setState('forecastHourly.' + i + 'h.precipitation', {
                        ack: true,
                        val: body.hourly_forecast[i].qpf[type]
                    }); // Quantitative precipitation forecast
                    adapter.setState('forecastHourly.' + i + 'h.snow', {
                        ack: true,
                        val: body.hourly_forecast[i].snow[type]
                    });
                    adapter.setState('forecastHourly.' + i + 'h.precipitationChance', {
                        ack: true,
                        val: body.hourly_forecast[i].pop
                    }); // probability of Precipitation
                    adapter.setState('forecastHourly.' + i + 'h.mslp', {
                        ack: true,
                        val: body.hourly_forecast[i].mslp[type]
                    }); // mean sea level pressure

                    qpfMax += Number(body.hourly_forecast[i].qpf[type]);
                    uviSum += Number(body.hourly_forecast[i].uvi);
                    if (Number(body.hourly_forecast[i].pop) > popMax) {
                        popMax = Number(body.hourly_forecast[i].pop);
                    }

                    // 6h
                    if (i === 5) {
                        adapter.setState('forecastHourly.6h.sum.precipitation', {ack: true, val: qpfMax});
                        adapter.setState('forecastHourly.6h.sum.precipitationChance', {ack: true, val: popMax});
                        adapter.setState('forecastHourly.6h.sum.uv', {ack: true, val: uviSum / 6});
                    }
                    // 12h
                    if (i === 11) {
                        adapter.setState('forecastHourly.12h.sum.precipitation', {ack: true, val: qpfMax});
                        adapter.setState('forecastHourly.12h.sum.precipitationChance', {ack: true, val: popMax});
                        adapter.setState('forecastHourly.12h.sum.uv', {ack: true, val: uviSum / 12});
                    }
                    // 24h
                    if (i === 23) {
                        adapter.setState('forecastHourly.24h.sum.precipitation', {ack: true, val: qpfMax});
                        adapter.setState('forecastHourly.24h.sum.precipitationChance', {ack: true, val: popMax});
                        adapter.setState('forecastHourly.24h.sum.uv', {ack: true, val: uviSum / 24});
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

function getWuData(apiKey, cb) {
    /*
        const url = 'http://api.wunderground.com/api/' + adapter.config.apiKey + '/forecast/hourly/lang:' + adapter.config.language + '/q/' + adapter.config.location + '.json';
    if (adapter.config.station.length > 2) {
        url = 'http://api.wunderground.com/api/' + adapter.config.apiKey + '/forecast/hourly/lang:' + adapter.config.language + '/q/pws:' + adapter.config.station + '.json';
    }
*/
    adapter.log.debug('Use API Key ' + apiKey);
    let url = 'http://api.wunderground.com/api/' + apiKey;

    if (adapter.config.forecast_periods_txt || adapter.config.forecast_periods) {
        url += '/forecast';
    }

    if (adapter.config.forecast_hourly) {
        url += '/hourly';
    }

    if (adapter.config.current) {
        url += '/conditions';
    }

    url += '/lang:' + adapter.config.language;

    if (adapter.config.station.length > 2) {
        url += '/q/pws:' + adapter.config.station;
    }
    else {
        url += '/q/' + adapter.config.location;
    }
    url += '.json';

    if (adapter.config.location.match(/^file:/)) {
        adapter.log.debug('calling WU: ' + adapter.config.location);
        return parseResult(JSON.parse(require('fs').readFileSync(adapter.config.location.substring(7)).toString('utf8')), cb);
    }
    adapter.log.debug('calling WU: ' + url);

    request({url: url, json: true, encoding: null}, (error, response, body) => {
        /*        body = iconv.decode(new Buffer(body), 'utf-8');
                try {
                    body = JSON.parse(body);
                } catch (e) {
                    adapter.log.error('Cannot parse answer: ' + body);
                    return;
                }*/
        if (!error && response.statusCode === 200) {
            if (body && body.response && body.response.error) {
                adapter.log.error('Error: ' + (typeof body.response.error === 'object' ? body.response.error.description || JSON.stringify(body.response.error) : body.response.error));
                return;
            }
            parseResult(body, cb);
        } else {
            // ERROR
            adapter.log.error('Wunderground reported an error: ' + error);
        }
        if (cb) cb();
    });
}

function checkWeatherVariables() {
    let id;
    if (adapter.config.current) {
        adapter.log.debug('init conditions objects');
        adapter.setObjectNotExists('forecast', {
            type: 'device',
            role: 'forecast',
            common: {
                name: 'Forecast for next 4 days days and current conditions'
            },
            native: {location: adapter.config.location}
        });
        adapter.setObjectNotExists('forecast.current', {
            type: 'channel',
            common: {
                name: 'Current conditions',
                role: 'weather'
            },
            native: {location: adapter.config.location}
        });

        adapter.setObjectNotExists('forecast.current.displayLocationFull', {
            type: 'state',
            common: {
                name: 'Display location full name',
                role: 'location',
                type: 'string'
            },
            native: {id: 'current_observation.display_location.full'}
        });
        adapter.setObjectNotExists('forecast.current.displayLocationLatitude', {
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
        adapter.setObjectNotExists('forecast.current.displayLocationLongitude', {
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
        adapter.setObjectNotExists('forecast.current.displayLocationElevation', {
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

        adapter.setObjectNotExists('forecast.current.observationLocationFull', {
            type: 'state',
            common: {
                name: 'Observation location full name',
                role: 'location',
                type: 'string'
            },
            native: {id: 'current_observation.observation_location.full'}
        });
        adapter.setObjectNotExists('forecast.current.observationLocationLatitude', {
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
        adapter.setObjectNotExists('forecast.current.observationLocationLongitude', {
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
        adapter.setObjectNotExists('forecast.current.observationLocationElevation', {
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
        adapter.setObjectNotExists('forecast.current.observationLocationStationID', {
            type: 'state',
            common: {name: 'WU station ID', role: 'state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.observation_location.station_id'}
        });

        adapter.setObjectNotExists('forecast.current.localTimeRFC822', {
            type: 'state',
            common: {name: 'Local time (rfc822)', role: 'state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.local_time_rfc822'}
        });
        adapter.setObjectNotExists('forecast.current.observationTimeRFC822', {
            type: 'state',
            common: {name: 'Observation time (rfc822)', role: 'state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.observation_time_rfc822'}
        });
        adapter.setObjectNotExists('forecast.current.observationTime', {
            type: 'state',
            common: {name: 'Observation time (rfc822)', role: 'date', type: 'string', read: true, write: false},
            native: {id: 'current_observation.local_epoch'}
        });
        adapter.setObjectNotExists('forecast.current.weather', {
            type: 'state',
            common: {name: 'Weather (engl.)', role: 'weather.state', type: 'string', read: true, write: false},
            native: {id: 'current_observation.weather'}
        });
        if (nonMetric) {
            adapter.setObjectNotExists('forecast.current.temp', {
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
            adapter.setObjectNotExists('forecast.current.dewPoint', {
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
            adapter.setObjectNotExists('forecast.current.windChill', {
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
            adapter.setObjectNotExists('forecast.current.feelsLike', {
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
            adapter.setObjectNotExists('forecast.current.visibility', {
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
            adapter.setObjectNotExists('forecast.current.temp', {
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
            adapter.setObjectNotExists('forecast.current.dewPoint', {
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
            adapter.setObjectNotExists('forecast.current.windChill', {
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
            adapter.setObjectNotExists('forecast.current.feelsLike', {
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
            adapter.setObjectNotExists('forecast.current.visibility', {
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

        adapter.setObjectNotExists('forecast.current.relativeHumidity', {
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
        adapter.setObjectNotExists('forecast.current.windDegrees', {
            type: 'state',
            common: {
                name: 'Wind direction',
                role: 'value.direction.wind',
                type: 'number',
                unit: '°',
                read: true,
                write: false
            },
            native: {id: 'current_observation.wind_degrees'}
        });

        if (nonMetric) {
            adapter.setObjectNotExists('forecast.current.wind', {
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
            adapter.setObjectNotExists('forecast.current.windGust', {
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
            adapter.setObjectNotExists('forecast.current.wind', {
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
            adapter.setObjectNotExists('forecast.current.windGust', {
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

        adapter.setObjectNotExists('forecast.current.pressure', { //PDE
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
        adapter.setObjectNotExists('forecast.current.solarRadiation', {
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
        adapter.setObjectNotExists('forecast.current.UV', {
            type: 'state',
            common: {name: 'UV-Index', role: 'value.uv', type: 'number', read: true, write: false},
            native: {id: 'current.UV'}
        });
        if (nonMetric) {
            adapter.setObjectNotExists('forecast.current.precipitationHour', {
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
            adapter.setObjectNotExists('forecast.current.precipitationDay', {
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
            adapter.setObjectNotExists('forecast.current.precipitationHour', {
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
            adapter.setObjectNotExists('forecast.current.precipitationDay', {
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
        adapter.setObjectNotExists('forecast.current.iconURL', {
            type: 'state',
            common: {
                name: 'URL to current weather icon',
                role: 'weather.icon',
                type: 'string',
                read: true,
                write: false
            },
            native: {id: 'current_observation.icon_url'}
        });
        adapter.setObjectNotExists('forecast.current.forecastURL', {
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
        adapter.setObjectNotExists('forecast.current.historyURL', {
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
        adapter.setObjectNotExists('forecastPeriod', {
            type: 'device',
            role: 'forecast',
            common: {name: 'next 8 day / night periods forecast with icon and text'},
            native: {location: adapter.config.location}
        });

        for (let d = 0; d < 8; d++) {
            id = 'forecastPeriod.' + d + 'p.';
            adapter.setObjectNotExists('forecastPeriod.' + d + 'p', {
                type: 'channel',
                role: 'weather.forecast.' + d,
                common: {name: 'in ' + d + 'periods'},
                native: {location: adapter.config.location}
            });
            adapter.setObjectNotExists(id + 'date', {
                type: 'state',
                common: {name: 'forecast for', type: 'string', role: 'date.forecast.' + d, read: true, write: false},
                native: {id: id + 'period'}
            });
            adapter.setObjectNotExists(id + 'icon', {
                type: 'state',
                common: {
                    name: 'icon',
                    type: 'string',
                    role: 'weather.icon.name.forecast.' + d,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon'}
            });
            adapter.setObjectNotExists(id + 'iconURL', {
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
            adapter.setObjectNotExists(id + 'title', {
                type: 'state',
                common: {name: 'title', type: 'string', role: 'weather.title.forecast.' + d, read: true, write: false},
                native: {id: id + 'title'}
            });
            adapter.setObjectNotExists(id + 'state', {
                type: 'state',
                common: {name: 'state', type: 'string', role: 'weather.state.forecast.' + d, read: true, write: false},
                native: {id: id + 'fcttext'}
            });
            adapter.setObjectNotExists(id + 'precipitationChance', {
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
        adapter.setObjectNotExists('forecast', {
            type: 'device',
            role: 'forecast',
            common: {name: 'Forecast for next 4 days days and current conditions'},
            native: {location: adapter.config.location}
        });

        for (let p = 0; p < 4; p++) {
            id = 'forecast.' + p + 'd.';
            adapter.setObjectNotExists('forecast.' + p + 'd', {
                type: 'channel',
                role: 'forecast',
                common: {name: 'in ' + p + 'days'},
                native: {location: adapter.config.location}
            });
            adapter.setObjectNotExists(id + 'date', {
                type: 'state',
                common: {name: 'forecast for', type: 'string', role: 'date.forecast.' + p, read: true, write: false},
                native: {id: id + 'date'}
            });
            if (nonMetric) {
                adapter.setObjectNotExists(id + 'tempMax', {
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
                adapter.setObjectNotExists(id + 'tempMin', {
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
                adapter.setObjectNotExists(id + 'precipitationAllDay', {
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
                adapter.setObjectNotExists(id + 'precipitationDay', {
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
                adapter.setObjectNotExists(id + 'precipitationNight', {
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

                adapter.setObjectNotExists(id + 'snowAllDay', {
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
                adapter.setObjectNotExists(id + 'snowDay', {
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
                adapter.setObjectNotExists(id + 'snowNight', {
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

                adapter.setObjectNotExists(id + 'windSpeedMax', {
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
                adapter.setObjectNotExists(id + 'windSpeed', {
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
                adapter.setObjectNotExists(id + 'tempMax', {
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
                adapter.setObjectNotExists(id + 'tempMin', {
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
                adapter.setObjectNotExists(id + 'precipitationAllDay', {
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
                adapter.setObjectNotExists(id + 'precipitationDay', {
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
                adapter.setObjectNotExists(id + 'precipitationNight', {
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

                adapter.setObjectNotExists(id + 'snowAllDay', {
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
                adapter.setObjectNotExists(id + 'snowDay', {
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
                adapter.setObjectNotExists(id + 'snowNight', {
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

                adapter.setObjectNotExists(id + 'windSpeedMax', {
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
                adapter.setObjectNotExists(id + 'windSpeed', {
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
            adapter.setObjectNotExists(id + 'icon', {
                type: 'state',
                common: {
                    name: 'forecast icon',
                    type: 'string',
                    role: 'weather.icon.name.forecast.' + p,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon'}
            });
            adapter.setObjectNotExists(id + 'state', {
                type: 'state',
                common: {
                    name: 'forecast state',
                    type: 'string',
                    role: 'weather.state.forecast.' + p,
                    read: true,
                    write: false
                },
                native: {id: id + 'icon'}
            });
            adapter.setObjectNotExists(id + 'iconURL', {
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
            adapter.setObjectNotExists(id + 'precipitationChance', {
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

            adapter.setObjectNotExists(id + 'windDirectionMax', {
                type: 'state',
                common: {
                    name: 'max. wind direction',
                    role: 'weather.direction.max.wind.forecast.' + p,
                    type: 'string',
                    read: true,
                    write: false
                },
                native: {id: id + 'maxwind.dir'}
            });
            adapter.setObjectNotExists(id + 'windDegreesMax', {
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
            adapter.setObjectNotExists(id + 'windDirection', {
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
            adapter.setObjectNotExists(id + 'windDegrees', {
                type: 'state',
                common: {
                    name: 'average wind direction',
                    role: 'value.direction.wind.forecast.' + p,
                    unit: '°',
                    type: 'number',
                    read: true,
                    write: false
                },
                native: {id: id + 'avewind.degrees'}
            });

            adapter.setObjectNotExists(id + 'humidity', {
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
            adapter.setObjectNotExists(id + 'humidityMax', {
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
            adapter.setObjectNotExists(id + 'humidityMin', {
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
        adapter.setObjectNotExists('forecastHourly', {
            type: 'device',
            role: 'forecast',
            common: {name: 'next 36h forecast'},
            native: {location: adapter.config.location}
        });

        for (let h = 0; h < 36; h++) {
            id = 'forecastHourly.' + h + 'h.';
            adapter.setObjectNotExists('forecastHourly.' + h + 'h', {
                type: 'channel',
                role: 'forecast',
                common: {name: 'in ' + h + 'h'},
                native: {location: adapter.config.location}
            });
            adapter.setObjectNotExists(id + 'time', {
                type: 'state',
                common: {name: 'forecast for', role: 'date', type: 'string', read: true, write: false},
                native: {id: id + 'time'}
            });
            adapter.setObjectNotExists(id + 'temp', {
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
            adapter.setObjectNotExists(id + 'fctcode', {
                type: 'state',
                common: {name: 'forecast description code', type: 'number', read: true, write: false},
                native: {id: id + 'fctcode'}
            });
            adapter.setObjectNotExists(id + 'sky', {
                type: 'state',
                common: {name: 'Sky (clear..covered)', type: 'number', unit: '%', read: true, write: false},
                native: {id: id + 'sky'}
            });
            adapter.setObjectNotExists(id + 'windSpeed', {
                type: 'state',
                common: {name: 'Windspeed', type: 'number', role: 'value.wind', unit: nonMetric ? 'm/h' : 'km/h', read: true, write: false},
                native: {id: id + 'wspd'}
            });
            adapter.setObjectNotExists(id + 'windDirection', {
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
            adapter.setObjectNotExists(id + 'uv', {
                type: 'state',
                common: {name: 'UV Index (0..~10)', type: 'number', role: 'value.uv', read: true, write: false},
                native: {id: id + 'uvi'}
            });
            adapter.setObjectNotExists(id + 'humidity', {
                type: 'state',
                common: {name: 'Humidity', type: 'number', role: 'value.humidity', unit: '%', read: true, write: false},
                native: {id: id + 'humidity'}
            });
            adapter.setObjectNotExists(id + 'heatIndex', {
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
            adapter.setObjectNotExists(id + 'feelsLike', {
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
            adapter.setObjectNotExists(id + 'precipitation', {
                type: 'state',
                common: {
                    name: 'Quantitative precipitation forecast',
                    type: 'value.precipitation',
                    role: 'value.rain',
                    unit: nonMetric ? 'in' : 'mm',
                    read: true,
                    write: false
                },
                native: {id: id + 'qpf.' + nonMetric ? 'metric' : 'english'}
            });
            adapter.setObjectNotExists(id + 'snow', {
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
            adapter.setObjectNotExists(id + 'precipitationChance', {
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
            adapter.setObjectNotExists(id + 'mslp', {
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
        }

        adapter.setObjectNotExists('forecastHourly.6h.sum.precipitation', {
            type: 'state',
            common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: nonMetric ? 'in' : 'mm', read: true, write: false},
            native: {id: 'forecast.6h.sum.qpf.' + nonMetric ? 'metric' : 'english'}
        });
        adapter.setObjectNotExists('forecastHourly.12h.sum.precipitation', {
            type: 'state',
            common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: nonMetric ? 'in' : 'mm', read: true, write: false},
            native: {id: 'forecast.12h.sum.qpf.' + nonMetric ? 'metric' : 'english'}
        });
        adapter.setObjectNotExists('forecastHourly.24h.sum.precipitation', {
            type: 'state',
            common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: nonMetric ? 'in' : 'mm', read: true, write: false},
            native: {id: 'forecast.24h.sum.qpf.' + nonMetric ? 'metric' : 'english'}
        });

        adapter.setObjectNotExists('forecastHourly.6h.sum.precipitationChance', {
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
        adapter.setObjectNotExists('forecastHourly.12h.sum.precipitationChance', {
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
        adapter.setObjectNotExists('forecastHourly.24h.sum.precipitationChance', {
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

        adapter.setObjectNotExists('forecastHourly.6h.sum.uv', {
            type: 'state',
            common: {name: 'avg. uvi', type: 'number', role: 'value.uv', read: true, write: false},
            native: {id: 'forecast.6h.sum.uvi'}
        });
        adapter.setObjectNotExists('forecastHourly.12h.sum.uv', {
            type: 'state',
            common: {name: 'avg. uvi', type: 'number', role: 'value.uv', read: true, write: false},
            native: {id: 'forecast.12h.sum.uvi'}
        });
        adapter.setObjectNotExists('forecastHourly.24h.sum.uv', {
            type: 'state',
            common: {name: 'avg. uvi', type: 'number', role: 'value.uv', read: true, write: false},
            native: {id: 'forecast.24h.sum.uvi'}
        });
    }
}
