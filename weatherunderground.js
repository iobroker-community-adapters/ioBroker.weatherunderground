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

"use strict";

var utils      = require(__dirname + '/lib/utils'); // Get common adapter utils
var request    = require('request');
var iconv      = require('iconv-lite');

var adapter = utils.adapter({
    name: 'weatherunderground',
    ready: function () {
        adapter.config.language = adapter.config.language || 'DL';
        checkWeatherVariables();
        getWuConditionsData();
        getWuForecastData(function () {
            setTimeout(function () {
                adapter.stop();
            }, 2000);
        });

        // force terminate after 1min
        // don't know why it does not terminate by itself...
        setTimeout(function () {
            adapter.log.warn('force terminate');
            process.exit(0);
        }, 60000);
    }
});

function getWuForecastData(cb) {
    var url = 'http://api.wunderground.com/api/' + adapter.config.apikey + '/hourly/lang:' + adapter.config.language + '/q/' + adapter.config.location + '.json';
    if (adapter.config.station.length > 2) {
        url = "http://api.wunderground.com/api/" + adapter.config.apikey + "/hourly/lang:" + adapter.config.language + "/q/pws:" + adapter.config.station + ".json";
    }
    adapter.log.debug('calling forecast: ' + url);

    request({url: url, json: true, encoding: null}, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var qpf_sum = 0;
            var pop_max = 0;
            var uvi_sum = 0;
            var ready = 0;

            if (body.hourly_forecast) {
                for (var i = 0; i < 24; i++) {
                    if (!body.hourly_forecast[i]) continue;
                    try {
                        //adapter.log.info("WU-Response Body: " + JSON.stringify(body.hourly_forecast[0].FCTTIME)); // Print the json response
                        //var forecast = JSON.parse(body.jsonData);
                        //adapter.log.info("version: " + body.response.version);
                        // see http://www.wunderground.com/weather/api/d/docs?d=resources/phrase-glossary for infos about properties and codes
                        adapter.setState('forecast.' + i + 'h.time',    {ack: true, val: body.hourly_forecast[i].FCTTIME.pretty});
                        adapter.setState('forecast.' + i + 'h.temp',    {ack: true, val: body.hourly_forecast[i].temp.metric});
                        adapter.setState('forecast.' + i + 'h.fctcode', {ack: true, val: body.hourly_forecast[i].fctcode}); //forecast description number -> see link above
                        adapter.setState('forecast.' + i + 'h.sky',     {ack: true, val: body.hourly_forecast[i].sky}); //?
                        adapter.setState('forecast.' + i + 'h.wspd',    {ack: true, val: body.hourly_forecast[i].wspd.metric}); // windspeed in kmh
                        adapter.setState('forecast.' + i + 'h.wdir',    {ack: true, val: body.hourly_forecast[i].wdir.degrees}); //wind dir in degrees
                        adapter.setState('forecast.' + i + 'h.uvi',     {ack: true, val: body.hourly_forecast[i].uvi}); //UV Index -> wikipedia
                        adapter.setState('forecast.' + i + 'h.humidity', {ack: true, val: body.hourly_forecast[i].humidity});
                        adapter.setState('forecast.' + i + 'h.heatindex', {ack: true, val: body.hourly_forecast[i].heatindex.metric}); // -> wikipedia
                        adapter.setState('forecast.' + i + 'h.feelslike', {ack: true, val: body.hourly_forecast[i].feelslike.metric}); // -> wikipedia
                        adapter.setState('forecast.' + i + 'h.qpf',     {ack: true, val: body.hourly_forecast[i].qpf.metric}); // Quantitative precipitation forecast
                        adapter.setState('forecast.' + i + 'h.snow',    {ack: true, val: body.hourly_forecast[i].snow.metric});
                        adapter.setState('forecast.' + i + 'h.pop',     {ack: true, val: body.hourly_forecast[i].pop}); // probability of Precipitation
                        adapter.setState('forecast.' + i + 'h.mslp',    {ack: true, val: body.hourly_forecast[i].mslp.metric}); // mean sea level pressure

                        qpf_sum += Number(body.hourly_forecast[i].qpf.metric);
                        uvi_sum += Number(body.hourly_forecast[i].uvi);
                        if (Number(body.hourly_forecast[i].pop) > pop_max) {
                            pop_max = Number(body.hourly_forecast[i].pop);
                        }

                        // 6h
                        if (i == 5) {
                            adapter.setState('forecast.6h.sum.qpf', {ack: true, val: qpf_sum});
                            adapter.setState('forecast.6h.sum.pop', {ack: true, val: pop_max});
                            adapter.setState('forecast.6h.sum.uvi', {ack: true, val: uvi_sum / 6});
                        }
                        // 12h
                        if (i == 11) {
                            adapter.setState('forecast.12h.sum.qpf', {ack: true, val: qpf_sum});
                            adapter.setState('forecast.12h.sum.pop', {ack: true, val: pop_max});
                            adapter.setState('forecast.12h.sum.uvi', {ack: true, val: uvi_sum / 12});
                        }
                        // 24h
                        if (i == 23) {
                            adapter.setState('forecast.24h.sum.qpf', {ack: true, val: qpf_sum});
                            adapter.setState('forecast.24h.sum.pop', {ack: true, val: pop_max});
                            adapter.setState('forecast.24h.sum.uvi', {ack: true, val: uvi_sum / 24});
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
        } else
        {
            // ERROR
            adapter.log.error('Wunderground reported an error: ' + error);
        }
        if (cb) cb();
    });
}

function getWuConditionsData() {
    var url = "http://api.wunderground.com/api/" + adapter.config.apikey + "/conditions/lang:" + adapter.config.language + "/q/" + adapter.config.location + ".json";

    if (adapter.config.station.length > 2) {
        url = "http://api.wunderground.com/api/" + adapter.config.apikey + "/conditions/lang:" + adapter.config.language + "/q/pws:" + adapter.config.station + ".json";
    }
    adapter.log.debug("calling forecast: " + url);
    request({url: url, encoding: null}, function(error, response, body) {
        body = iconv.decode(new Buffer(body), 'utf-8');
        body = JSON.parse(body);
        if (!error && response.statusCode === 200) {
            if (body.current_observation) {
                try {
                    adapter.setState("current.display_location.full", {ack: true, val: body.current_observation.display_location.full});
                    adapter.setState("current.display_location.latitude", {ack: true, val: parseFloat(body.current_observation.display_location.latitude)});
                    adapter.setState("current.display_location.longitude", {ack: true, val: parseFloat(body.current_observation.display_location.longitude)});
                    adapter.setState("current.display_location.elevation", {ack: true, val: parseFloat(body.current_observation.display_location.elevation)});

                    adapter.setState("current.observation_location.full", {ack: true, val: body.current_observation.observation_location.full});
                    adapter.setState("current.observation_location.latitude", {ack: true, val: parseFloat(body.current_observation.observation_location.latitude)});
                    adapter.setState("current.observation_location.longitude", {ack: true, val: parseFloat(body.current_observation.observation_location.longitude)});
                    adapter.setState("current.observation_location.elevation", {ack: true, val: (parseFloat(body.current_observation.observation_location.elevation) * 0.3048).toFixed(2)}); // convert ft to m

                    adapter.setState("current.observation_location.station_id", {ack: true, val: body.current_observation.station_id});
                    adapter.setState("current.local_time_rfc822", {ack: true, val: body.current_observation.local_time_rfc822});
                    adapter.setState("current.weather", {ack: true, val: body.current_observation.weather});
                    adapter.setState("current.temp_c", {ack: true, val: parseFloat(body.current_observation.temp_c)});
                    adapter.setState("current.relative_humidity", {ack: true, val: parseFloat(body.current_observation.relative_humidity.replace('%', ''))});
                    adapter.setState("current.wind_degrees", {ack: true, val: parseFloat(body.current_observation.wind_degrees)});
                    adapter.setState("current.wind_kph", {ack: true, val: parseFloat(body.current_observation.wind_kph)});
                    adapter.setState("current.wind_gust_kph", {ack: true, val: parseFloat(body.current_observation.wind_gust_kph)});
                    adapter.setState("current.dewpoint_c", {ack: true, val: parseFloat(body.current_observation.dewpoint_c)});
                    adapter.setState("current.windchill_c", {ack: true, val: parseFloat(body.current_observation.windchill_c)});
                    adapter.setState("current.feelslike_c", {ack: true, val: parseFloat(body.current_observation.feelslike_c)});
                    adapter.setState("current.visibility_km", {ack: true, val: parseFloat(body.current_observation.visibility_km)});
                    adapter.setState("current.solarradiation", {ack: true, val: body.current_observation.solarradiation});
                    adapter.setState("current.UV", {ack: true, val: parseFloat(body.current_observation.UV)});
                    adapter.setState("current.precip_1hr_metric", {ack: true, val: (isNaN(parseInt(body.current_observation.precip_1hr_metric, 10)) ? null : parseInt(body.current_observation.precip_1hr_metric, 10))});
                    adapter.setState("current.precip_today_metric", {ack: true, val: (isNaN(parseInt(body.current_observation.precip_today_metric, 10)) ? null : parseInt(body.current_observation.precip_today_metric, 10))});
                    adapter.setState("current.icon_url", {ack: true, val: body.current_observation.icon_url});
                    adapter.setState("current.forecast_url", {ack: true, val: body.current_observation.forecast_url});
                    adapter.setState("current.history_url", {ack: true, val: body.current_observation.history_url});
                    adapter.log.debug("all current conditions values set");
                } catch (error) {
                    adapter.log.error("Could not parse Conditions-Data: " + error);
                    adapter.log.error("Reported WU-Error Type: " + body.response.error.type);
                }
            }
            else {
            	adapter.log.error('No current observation data found in response');
            }
        } else
        {
            // ERROR
            adapter.log.error("Wunderground reported an error: " + error);
        }
    });
}

function checkWeatherVariables() {
    adapter.log.debug("init conditions objects");
    adapter.setObjectNotExists('current', {
        type: 'channel',
        role: 'weather',
        common: {name: 'weatherunderground current conditions'},
        native: {location: adapter.config.location}
    });

    adapter.setObjectNotExists('current.display_location.full', {
        type: 'state',
        common: {name: 'display location full name'},
        native: {id: 'current.display_location.full'}
    });
    adapter.setObjectNotExists('current.display_location.latitude', {
        type: 'state',
        common: {name: 'display location latitude', role: 'value.latitude', type: 'number', unit: '°', read: true, write: false},
        native: {id: 'current.display_location.latitude'}
    });
    adapter.setObjectNotExists('current.display_location.longitude', {
        type: 'state',
        common: {name: 'display location longitude', role: 'value.longitude', type: 'number', unit: '°', read: true, write: false},
        native: {id: 'current.display_location.longitude'}
    });
    adapter.setObjectNotExists('current.display_location.elevation', {
        type: 'state',
        common: {name: 'display location elevation', role: 'value.elevation', type: 'number', unit: 'm', read: true, write: false},
        native: {id: 'current.display_location.elevation'}
    });

    adapter.setObjectNotExists('current.observation_location.full', {
        type: 'state',
        common: {name: 'observation location full name'},
        native: {id: 'current.observation_location.full'}
    });
    adapter.setObjectNotExists('current.observation_location.latitude', {
        type: 'state',
        common: {name: 'observation location latitude', role: 'value.latitude', type: 'number', unit: '°', read: true, write: false},
        native: {id: 'current.observation_location.latitude'}
    });
    adapter.setObjectNotExists('current.observation_location.longitude', {
        type: 'state',
        common: {name: 'observation location longitude', role: 'value.longitude', type: 'number', unit: '°', read: true, write: false},
        native: {id: 'current.observation_location.longitude'}
    });
    adapter.setObjectNotExists('current.observation_location.elevation', {
        type: 'state',
        common: {name: 'observation location elevation', role: 'value.elevation', type: 'number', unit: 'm', read: true, write: false},
        native: {id: 'current.observation_location.elevation'}
    });
    adapter.setObjectNotExists('current.observation_location.station_id', {
        type: 'state',
        common: {name: 'wu station ID', role: 'id', type: 'string', read: true, write: false},
        native: {id: 'current.observation_location.station_id'}
    });

    adapter.setObjectNotExists('current.local_time_rfc822', {
        type: 'state',
        common: {name: 'time (rfc822)', role: 'time', type: 'string', read: true, write: false},
        native: {id: 'current.local_time_rfc822'}
    });
    adapter.setObjectNotExists('current.weather', {
        type: 'state',
        common: {name: 'weather (engl.)', type: 'string', read: true, write: false},
        native: {id: 'current.weather'}
    });
    adapter.setObjectNotExists('current.temp_c', {
        type: 'state',
        common: {name: 'Temperature', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false},
        native: {id: 'current.temp_c'}
    });
    adapter.setObjectNotExists('current.relative_humidity', {
        type: 'state',
        common: {name: 'Relative humidity', role: 'value.humidity', type: 'number', unit: '%', read: true, write: false},
        native: {id: 'current.relative_humidity'}
    });
    adapter.setObjectNotExists('current.wind_degrees', {
        type: 'state',
        common: {name: 'Wind direction', role: 'value.winddir', type: 'number', unit: '°', read: true, write: false},
        native: {id: 'current.wind_degrees'}
    });
    adapter.setObjectNotExists('current.wind_kph', {
        type: 'state',
        common: {name: 'Wind speed', role: 'value.wind', type: 'number', unit: 'km/h', read: true, write: false},
        native: {id: 'current.wind_kph'}
    });
    adapter.setObjectNotExists('current.wind_gust_kph', {
        type: 'state',
        common: {name: 'Wind gust', role: 'value.wind', type: 'number', unit: 'km/h', read: true, write: false},
        native: {id: 'current.wind_gust_kph'}
    });
    adapter.setObjectNotExists('current.dewpoint_c', {
        type: 'state',
        common: {name: 'Dewpoint', role: 'value.temperature', type: 'number', unit:'°C', read: true, write: false},
        native: {id: 'current.dewpoint_c'}
    });
    adapter.setObjectNotExists('current.windchill_c', {
        type: 'state',
        common: {name: 'Windchill', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false},
        native: {id: 'current.windchill_c'}
    });
    adapter.setObjectNotExists('current.feelslike_c', {
        type: 'state',
        common: {name: 'Temperature feels like', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false},
        native: {id: 'current.feelslike_c'}
    });
    adapter.setObjectNotExists('current.visibility_km', {
        type: 'state',
        common: {name: 'Visibility', role: 'value.distance', type: 'number', unit: 'km', read: true, write: false},
        native: {id: 'current.visibility_km'}
    });
    adapter.setObjectNotExists('current.solarradiation', {
        type: 'state',
        common: {name: 'Solar radiation', role: 'value.radiation', type: 'number', unit: 'w/m2', read: true, write: false},
        native: {id: 'current.solarradiation'}
    });
    adapter.setObjectNotExists('current.UV', {
        type: 'state',
        common: {name: 'UV-Index', role: 'value.index', type: 'number', read: true, write: false},
        native: {id: 'current.UV'}
    });
    adapter.setObjectNotExists('current.precip_1hr_metric', {
        type: 'state',
        common: {name: 'precipitation (last 1h)', role: 'value.rain', type: 'number', unit: 'mm', read: true, write: false},
        native: {id: 'current.precip_1hr_metric'}
    });
    adapter.setObjectNotExists('current.precip_today_metric', {
        type: 'state',
        common: {name: 'precipitation (today)', role: 'value.rain', type: 'number', unit: 'mm', read: true, write: false},
        native: {id: 'current.precip_today_metric'}
    });
    adapter.setObjectNotExists('current.icon_url', {
        type: 'state',
        common: {name: 'url to current weather icon', role: 'url.icon', type: 'string', read: true, write: false},
        native: {id: 'current.icon_url'}
    });
    adapter.setObjectNotExists('current.forecast_url', {
        type: 'state',
        common: {name: 'url to wu-forecast page', role: 'url.page', type: 'string', read: true, write: false},
        native: {id: 'current.forecast_url'}
    });
    adapter.setObjectNotExists('current.history_url', {
        type: 'state',
        common: {name: 'url to wu-history page', role: 'url.page', type: 'string', read: true, write: false},
        native: {id: 'current.history_url'}
    });


    adapter.log.debug("init forecast objects");

    adapter.setObjectNotExists('forecast', {
        type: 'channel',
        role: 'forecast',
        common: {name: 'weatherunderground 24h forecast'},
        native: {location: adapter.config.location}
    });

    for (var h=0; h < 24; h++) {
        var id = "forecast." + h + "h.";
        adapter.setObjectNotExists('forecast.' + h + 'h', {
            type: 'channel',
            role: 'forecast',
            common: {name: 'in ' + h + 'h'},
            native: {location: adapter.config.location}
        });
        adapter.setObjectNotExists(id + 'time', {
            type: 'state',
            common: {name: 'forecast for', type: 'string', read: true, write: false},
            native: {id: id + 'time'}
        });
        adapter.setObjectNotExists(id + 'temp', {
            type: 'state',
            common: {name: 'Temperature', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false},
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
        adapter.setObjectNotExists(id + 'wspd', {
            type: 'state',
            common: {name: 'Windspeed', type: 'number', role: 'value.wind', unit: 'km/h', read: true, write: false},
            native: {id: id + 'wspd'}
        });
        adapter.setObjectNotExists(id + 'wdir', {
            type: 'state',
            common: {name: 'Wind direction', type: 'number', role: 'value.winddir', unit: '°', read: true, write: false},
            native: {id: id + 'wdir'}
        });
        adapter.setObjectNotExists(id + 'uvi', {
            type: 'state',
            common: {name: 'UV Index (0..~10)', type: 'number', role: 'value.index', read: true, write: false},
            native: {id: id + 'uvi'}
        });
        adapter.setObjectNotExists(id + 'humidity', {
            type: 'state',
            common: {name: 'Humidity', type: 'number', role: 'value.humidity', unit: '%', read: true, write: false},
            native: {id: id + 'humidity'}
        });
        adapter.setObjectNotExists(id + 'heatindex', {
            type: 'state',
            common: {name: 'Heatindex', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false},
            native: {id: id + 'heatindex'}
        });
        adapter.setObjectNotExists(id + 'feelslike', {
            type: 'state',
            common: {name: 'Feels like', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false},
            native: {id: id + 'feelslike'}
        });
        adapter.setObjectNotExists(id + 'qpf', {
            type: 'state',
            common: {name: 'Quantitative precipitation forecast', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
            native: {id: id + 'qpf'}
        });
        adapter.setObjectNotExists(id + 'snow', {
            type: 'state',
            common: {name: 'Snow precipitation', type: 'number', role: 'value.snow', unit: 'mm', read: true, write: false},
            native: {id: id + 'snow'}
        });
        adapter.setObjectNotExists(id + 'pop', {
            type: 'state',
            common: {name: 'Percentage of precipitation', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
            native: {id: id + 'pop'}
        });
        adapter.setObjectNotExists(id + 'mslp', {
            type: 'state',
            common: {name: 'Mean sea level pressure', type: 'number', role: 'value.pressure', unit: 'hPa', read: true, write: false},
            native: {id: id + 'mslp'}
        });
    }

    adapter.setObjectNotExists('forecast.6h.sum.qpf', {
        type: 'state',
        common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
        native: {id: 'forecast.6h.sum.qpf'}
    });
    adapter.setObjectNotExists('forecast.12h.sum.qpf', {
        type: 'state',
        common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
        native: {id: 'forecast.12h.sum.qpf'}
    });
    adapter.setObjectNotExists('forecast.24h.sum.qpf', {
        type: 'state',
        common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
        native: {id: 'forecast.24h.sum.qpf'}
    });

    adapter.setObjectNotExists('forecast.6h.sum.pop', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.6h.sum.pop'}
    });
    adapter.setObjectNotExists('forecast.12h.sum.pop', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.12h.sum.pop'}
    });
    adapter.setObjectNotExists('forecast.24h.sum.pop', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.24h.sum.pop'}
    });

    adapter.setObjectNotExists('forecast.6h.sum.uvi', {
        type: 'state',
        common: {name: 'avg. uvi', type: 'number', role: 'value.index', read: true, write: false},
        native: {id: 'forecast.6h.sum.uvi'}
    });
    adapter.setObjectNotExists('forecast.12h.sum.uvi', {
        type: 'state',
        common: {name: 'avg. uvi', type: 'number', role: 'value.index', read: true, write: false},
        native: {id: 'forecast.12h.sum.uvi'}
    });
    adapter.setObjectNotExists('forecast.24h.sum.uvi', {
        type: 'state',
        common: {name: 'avg. uvi', type: 'number', role: 'value.index', read: true, write: false},
        native: {id: 'forecast.24h.sum.uvi'}
    });
}
