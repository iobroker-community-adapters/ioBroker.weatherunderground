/* jshint -W097 */
// jshint strict:false
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

var utils      = require(__dirname + '/lib/utils'); // Get common adapter utils
var request    = require('request');
var iconv      = require('iconv-lite');

var adapter = utils.adapter('weatherunderground');

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.debug('objectChange 123 ' + id + ' ' + JSON.stringify(obj));

    //feuert auch, wenn adapter im admin angehalten oder gestartet wird...
    adapter.log.debug('on objectChange : ' + adapter.config.language + ' ' + adapter.config.forecast_periods_txt + ' ' + adapter.config.forecast_periods + ' ' + adapter.config.current + ' ' + adapter.config.forecast_hourly);


});

adapter.on('ready', function () {

    adapter.config.language = adapter.config.language || 'DL';

    if (typeof adapter.config.forecast_periods_txt == 'undefined') {
        adapter.log.info("forecast_periods_txt not defined. now enabled. check settings and save");
        adapter.config.forecast_periods_txt = true;
    }
    if (typeof adapter.config.forecast_periods == 'undefined') {
        adapter.log.info("forecast_periods not defined. now enabled. check settings and save");
        adapter.config.forecast_periods = true;
    }
    if (typeof adapter.config.forecast_hourly == 'undefined') {
        adapter.log.info("forecast_hourly not defined. now enabled. check settings and save");
        adapter.config.forecast_hourly = true;
    }
    if (typeof adapter.config.current == 'undefined') {
        adapter.log.info("current not defined. now enabled. check settings and save");
        adapter.config.current = true;
    }
    if (typeof adapter.config.custom_icon_base_url == 'undefined') {
        adapter.config.custom_icon_base_url = "";
    }
    else {
        adapter.config.custom_icon_base_url = adapter.config.custom_icon_base_url.trim();
        if (adapter.config.custom_icon_base_url !== "" && adapter.config.custom_icon_base_url[adapter.config.custom_icon_base_url.length-1] !== "/") {
            adapter.config.custom_icon_base_url += "/";
        }
    }
    adapter.log.debug('on ready 222 : ' + adapter.config.language + ' ' + adapter.config.forecast_periods_txt + ' ' + adapter.config.forecast_periods + ' ' + adapter.config.current + ' ' + adapter.config.forecast_hourly);

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
});

function handleIconUrl(original) {
    if (adapter.config.custom_icon_base_url !== "") {
        adapter.log.info('Found Custom Icon URL: ' + adapter.config.custom_icon_base_url);
        original = adapter.config.custom_icon_base_url + original.substring(original.lastIndexOf('/')+1);
    }
    return original;
}

function getWuForecastData(cb) {
    /*
        var url = 'http://api.wunderground.com/api/' + adapter.config.apikey + '/forecast/hourly/lang:' + adapter.config.language + '/q/' + adapter.config.location + '.json';
    if (adapter.config.station.length > 2) {
        url = 'http://api.wunderground.com/api/' + adapter.config.apikey + '/forecast/hourly/lang:' + adapter.config.language + '/q/pws:' + adapter.config.station + '.json';
    }
*/
    var url = 'http://api.wunderground.com/api/' + adapter.config.apikey;

    if (adapter.config.forecast_periods_txt == true || adapter.config.forecast_periods == true) {
        url += '/forecast';
    }

    if (adapter.config.forecast_hourly == true) {
        url += '/hourly';
    }
    url += '/lang:';


    url += adapter.config.language;
    if (adapter.config.station.length > 2) {
        url += '/q/pws:' + adapter.config.station;
    }
    else {
        url += '/q/' + adapter.config.location;
    }
    url += '.json';

    adapter.log.debug('calling forecast: ' + url);

    request({ url: url, json: true, encoding: null }, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            var qpf_sum = 0;
            var pop_max = 0;
            var uvi_sum = 0;

            //adapter.log.debug('000 ' + adapter.config.forecast_periods_txt + " " + adapter.config.forecast_periods + " " + adapter.config.forecast_hourly);
            //next 8 periods (day and night) -> text and icon forecast
            if (adapter.config.forecast_periods_txt == true) {
                //adapter.log.debug('111');
                if (body.forecast && body.forecast.txt_forecast && body.forecast.txt_forecast.forecastday) {
                    //adapter.log.debug('222');
                    for (var i = 0; i < 8; i++) {
                        //adapter.log.debug('333');
                        if (!body.forecast.txt_forecast.forecastday[i]) continue;
                        //adapter.log.debug('444');
                        try {
                            adapter.setState('forecast_period.' + i + 'p.period', { ack: true, val: body.forecast.txt_forecast.forecastday[i].period });
                            adapter.setState('forecast_period.' + i + 'p.icon', { ack: true, val: body.forecast.txt_forecast.forecastday[i].icon });
                            adapter.setState('forecast_period.' + i + 'p.icon_URL', { ack: true, val: handleIconUrl(body.forecast.txt_forecast.forecastday[i].icon_url) });
                            adapter.setState('forecast_period.' + i + 'p.title', { ack: true, val: body.forecast.txt_forecast.forecastday[i].title });
                            adapter.setState('forecast_period.' + i + 'p.fcttext', { ack: true, val: body.forecast.txt_forecast.forecastday[i].fcttext });
                            adapter.setState('forecast_period.' + i + 'p.fcttext_metric', { ack: true, val: body.forecast.txt_forecast.forecastday[i].fcttext_metric });
                            adapter.setState('forecast_period.' + i + 'p.pop', { ack: true, val: body.forecast.txt_forecast.forecastday[i].pop });
                        }
                        catch (error) {
                            adapter.log.error('exception in : body.txt_forecast' + error);
                        }
                    }
                }
            }

            if (adapter.config.forecast_periods == true) {
                //next 4 days
                //adapter.log.debug('555');
                if (body.forecast && body.forecast.simpleforecast && body.forecast.simpleforecast.forecastday) {
                    //adapter.log.debug('666');
                    for (var i = 0; i < 4; i++) {
                        //adapter.log.debug('777');
                        if (!body.forecast.simpleforecast.forecastday[i]) continue;
                        //adapter.log.debug('888');
                        try {
                            adapter.setState('forecast_day.' + i + 'd.date', { ack: true, val: body.forecast.simpleforecast.forecastday[i].date.pretty });
                            adapter.setState('forecast_day.' + i + 'd.temp.high', { ack: true, val: body.forecast.simpleforecast.forecastday[i].high.celsius });
                            adapter.setState('forecast_day.' + i + 'd.temp.low', { ack: true, val: body.forecast.simpleforecast.forecastday[i].low.celsius });
                            adapter.setState('forecast_day.' + i + 'd.icon', { ack: true, val: body.forecast.simpleforecast.forecastday[i].icon });
                            adapter.setState('forecast_day.' + i + 'd.icon_url', { ack: true, val: handleIconUrl(body.forecast.simpleforecast.forecastday[i].icon_url) });
                            adapter.setState('forecast_day.' + i + 'd.pop', { ack: true, val: body.forecast.simpleforecast.forecastday[i].pop });
                            adapter.setState('forecast_day.' + i + 'd.qpf.allday', { ack: true, val: body.forecast.simpleforecast.forecastday[i].qpf_allday.mm });
                            adapter.setState('forecast_day.' + i + 'd.qpf.day', { ack: true, val: body.forecast.simpleforecast.forecastday[i].qpf_day.mm });
                            adapter.setState('forecast_day.' + i + 'd.qpf.night', { ack: true, val: body.forecast.simpleforecast.forecastday[i].qpf_night.mm });
                            adapter.setState('forecast_day.' + i + 'd.snow.allday', { ack: true, val: body.forecast.simpleforecast.forecastday[i].snow_allday.cm });
                            adapter.setState('forecast_day.' + i + 'd.snow.day', { ack: true, val: body.forecast.simpleforecast.forecastday[i].snow_day.cm });
                            adapter.setState('forecast_day.' + i + 'd.snow.night', { ack: true, val: body.forecast.simpleforecast.forecastday[i].snow_night.cm });

                            adapter.setState('forecast_day.' + i + 'd.maxwind.kph', { ack: true, val: body.forecast.simpleforecast.forecastday[i].maxwind.kph });
                            adapter.setState('forecast_day.' + i + 'd.maxwind.dir', { ack: true, val: body.forecast.simpleforecast.forecastday[i].maxwind.dir });
                            adapter.setState('forecast_day.' + i + 'd.maxwind.degrees', { ack: true, val: body.forecast.simpleforecast.forecastday[i].maxwind.degrees });

                            adapter.setState('forecast_day.' + i + 'd.avewind.kph', { ack: true, val: body.forecast.simpleforecast.forecastday[i].avewind.kph });
                            adapter.setState('forecast_day.' + i + 'd.avewind.dir', { ack: true, val: body.forecast.simpleforecast.forecastday[i].avewind.dir });
                            adapter.setState('forecast_day.' + i + 'd.avewind.degrees', { ack: true, val: body.forecast.simpleforecast.forecastday[i].avewind.degrees });

                            adapter.setState('forecast_day.' + i + 'd.avehumidity', { ack: true, val: body.forecast.simpleforecast.forecastday[i].avehumidity });
                            adapter.setState('forecast_day.' + i + 'd.maxhumidity', { ack: true, val: body.forecast.simpleforecast.forecastday[i].maxhumidity });
                            adapter.setState('forecast_day.' + i + 'd.minhumidity', { ack: true, val: body.forecast.simpleforecast.forecastday[i].minhumidity });


                        }
                        catch (error) {
                            adapter.log.error('exception in : body.simpleforecast' + error);
                        }
                    }
                }
            }

            if (adapter.config.forecast_hourly == true) {

                // next 24 hours
                if (body.hourly_forecast) {
                    for (var i = 0; i < 36; i++) {
                        //adapter.log.debug('999');
                        if (!body.hourly_forecast[i]) continue;
                        //adapter.log.debug('AAA');
                        try {
                            //adapter.log.info("WU-Response Body: " + JSON.stringify(body.hourly_forecast[0].FCTTIME)); // Print the json response
                            //var forecast = JSON.parse(body.jsonData);
                            //adapter.log.info("version: " + body.response.version);
                            // see http://www.wunderground.com/weather/api/d/docs?d=resources/phrase-glossary for infos about properties and codes
                            adapter.setState('forecast.' + i + 'h.time', { ack: true, val: body.hourly_forecast[i].FCTTIME.pretty });
                            adapter.setState('forecast.' + i + 'h.temp', { ack: true, val: body.hourly_forecast[i].temp.metric });
                            adapter.setState('forecast.' + i + 'h.fctcode', { ack: true, val: body.hourly_forecast[i].fctcode }); //forecast description number -> see link above
                            adapter.setState('forecast.' + i + 'h.sky', { ack: true, val: body.hourly_forecast[i].sky }); //?
                            adapter.setState('forecast.' + i + 'h.wspd', { ack: true, val: body.hourly_forecast[i].wspd.metric }); // windspeed in kmh
                            adapter.setState('forecast.' + i + 'h.wdir', { ack: true, val: body.hourly_forecast[i].wdir.degrees }); //wind dir in degrees
                            adapter.setState('forecast.' + i + 'h.uvi', { ack: true, val: body.hourly_forecast[i].uvi }); //UV Index -> wikipedia
                            adapter.setState('forecast.' + i + 'h.humidity', { ack: true, val: body.hourly_forecast[i].humidity });
                            adapter.setState('forecast.' + i + 'h.heatindex', { ack: true, val: body.hourly_forecast[i].heatindex.metric }); // -> wikipedia
                            adapter.setState('forecast.' + i + 'h.feelslike', { ack: true, val: body.hourly_forecast[i].feelslike.metric }); // -> wikipedia
                            adapter.setState('forecast.' + i + 'h.qpf', { ack: true, val: body.hourly_forecast[i].qpf.metric }); // Quantitative precipitation forecast
                            adapter.setState('forecast.' + i + 'h.snow', { ack: true, val: body.hourly_forecast[i].snow.metric });
                            adapter.setState('forecast.' + i + 'h.pop', { ack: true, val: body.hourly_forecast[i].pop }); // probability of Precipitation
                            adapter.setState('forecast.' + i + 'h.mslp', { ack: true, val: body.hourly_forecast[i].mslp.metric }); // mean sea level pressure

                            qpf_sum += Number(body.hourly_forecast[i].qpf.metric);
                            uvi_sum += Number(body.hourly_forecast[i].uvi);
                            if (Number(body.hourly_forecast[i].pop) > pop_max) {
                                pop_max = Number(body.hourly_forecast[i].pop);
                            }

                            // 6h
                            if (i == 5) {
                                adapter.setState('forecast.6h.sum.qpf', { ack: true, val: qpf_sum });
                                adapter.setState('forecast.6h.sum.pop', { ack: true, val: pop_max });
                                adapter.setState('forecast.6h.sum.uvi', { ack: true, val: uvi_sum / 6 });
                            }
                            // 12h
                            if (i == 11) {
                                adapter.setState('forecast.12h.sum.qpf', { ack: true, val: qpf_sum });
                                adapter.setState('forecast.12h.sum.pop', { ack: true, val: pop_max });
                                adapter.setState('forecast.12h.sum.uvi', { ack: true, val: uvi_sum / 12 });
                            }
                            // 24h
                            if (i == 23) {
                                adapter.setState('forecast.24h.sum.qpf', { ack: true, val: qpf_sum });
                                adapter.setState('forecast.24h.sum.pop', { ack: true, val: pop_max });
                                adapter.setState('forecast.24h.sum.uvi', { ack: true, val: uvi_sum / 24 });
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
        } else {
            // ERROR
            adapter.log.error('Wunderground reported an error: ' + error);
        }
        if (cb) cb();
    });
}

function getWuConditionsData() {
    //adapter.log.debug('BBB ' + adapter.config.current);
    if (adapter.config.current == true) {

        var url = 'http://api.wunderground.com/api/' + adapter.config.apikey + '/conditions/lang:' + adapter.config.language + '/q/' + adapter.config.location + '.json';

        if (adapter.config.station.length > 2) {
            url = 'http://api.wunderground.com/api/' + adapter.config.apikey + '/conditions/lang:' + adapter.config.language + '/q/pws:' + adapter.config.station + '.json';
        }
        adapter.log.debug('calling current: ' + url);
        request({ url: url, encoding: null }, function (error, response, body) {
            body = iconv.decode(new Buffer(body), 'utf-8');
            try {
                body = JSON.parse(body);
            } catch (e) {
                adapter.log.error('Cannot parse answer: ' + body);
                return;
            }
            if (!error && response.statusCode === 200) {
                if (body.current_observation) {
                    try {
                        adapter.setState('current.display_location.full', { ack: true, val: body.current_observation.display_location.full });
                        adapter.setState('current.display_location.latitude', { ack: true, val: parseFloat(body.current_observation.display_location.latitude) });
                        adapter.setState('current.display_location.longitude', { ack: true, val: parseFloat(body.current_observation.display_location.longitude) });
                        adapter.setState('current.display_location.elevation', { ack: true, val: parseFloat(body.current_observation.display_location.elevation) });

                        adapter.setState('current.observation_location.full', { ack: true, val: body.current_observation.observation_location.full });
                        adapter.setState('current.observation_location.latitude', { ack: true, val: parseFloat(body.current_observation.observation_location.latitude) });
                        adapter.setState('current.observation_location.longitude', { ack: true, val: parseFloat(body.current_observation.observation_location.longitude) });
                        adapter.setState('current.observation_location.elevation', { ack: true, val: (parseFloat(body.current_observation.observation_location.elevation) * 0.3048).toFixed(2) }); // convert ft to m

                        adapter.setState('current.observation_location.station_id', { ack: true, val: body.current_observation.station_id });
                        adapter.setState('current.local_time_rfc822', { ack: true, val: body.current_observation.local_time_rfc822 });
                        adapter.setState('current.observation_time_rfc822', { ack: true, val: body.current_observation.observation_time_rfc822 }); // PDE

                        adapter.setState('current.weather', { ack: true, val: body.current_observation.weather });
                        adapter.setState('current.temp_c', { ack: true, val: parseFloat(body.current_observation.temp_c) });
                        adapter.setState('current.relative_humidity', { ack: true, val: parseFloat(body.current_observation.relative_humidity.replace('%', '')) });
                        adapter.setState('current.wind_degrees', { ack: true, val: parseFloat(body.current_observation.wind_degrees) });
                        adapter.setState('current.wind_kph', { ack: true, val: parseFloat(body.current_observation.wind_kph) });
                        adapter.setState('current.wind_gust_kph', { ack: true, val: parseFloat(body.current_observation.wind_gust_kph) });

                        adapter.setState('current.pressure_mb', { ack: true, val: parseFloat(body.current_observation.pressure_mb) }); //PDE
                        adapter.setState('current.dewpoint_c', { ack: true, val: parseFloat(body.current_observation.dewpoint_c) });
                        adapter.setState('current.windchill_c', { ack: true, val: parseFloat(body.current_observation.windchill_c) });
                        adapter.setState('current.feelslike_c', { ack: true, val: parseFloat(body.current_observation.feelslike_c) });
                        adapter.setState('current.visibility_km', { ack: true, val: parseFloat(body.current_observation.visibility_km) });
                        adapter.setState('current.solarradiation', { ack: true, val: body.current_observation.solarradiation });
                        adapter.setState('current.UV', { ack: true, val: parseFloat(body.current_observation.UV) });
                        if (!isNaN(parseInt(body.current_observation.precip_1hr_metric, 10))) {
                            adapter.setState('current.precip_1hr_metric', { ack: true, val: parseInt(body.current_observation.precip_1hr_metric, 10) });
                        }
                        if (!isNaN(parseInt(body.current_observation.precip_today_metric, 10))) {
                            adapter.setState('current.precip_today_metric', { ack: true, val: parseInt(body.current_observation.precip_today_metric, 10) });
                        }
                        adapter.setState('current.icon_url', { ack: true, val: handleIconUrl(body.current_observation.icon_url) });
                        adapter.setState('current.forecast_url', { ack: true, val: body.current_observation.forecast_url });
                        adapter.setState('current.history_url', { ack: true, val: body.current_observation.history_url });
                        adapter.log.debug('all current conditions values set');
                    } catch (error) {
                        adapter.log.error('Could not parse Conditions-Data: ' + error);
                        adapter.log.error('Reported WU-Error Type: ' + body.response.error.type);
                    }
                } else {
                    adapter.log.error('No current observation data found in response');
                }
            } else {
                // ERROR
                adapter.log.error('Wunderground reported an error: ' + error);
            }
        });
    }
}

function checkWeatherVariables() {
    if (adapter.config.current == true) {
        adapter.log.debug("init conditions objects");
        adapter.setObjectNotExists('current', {
            type: 'channel',
            role: 'weather',
            common: { name: 'Current conditions' },
            native: { location: adapter.config.location }
        });

        adapter.setObjectNotExists('current.display_location.full', {
            type: 'state',
            common: { name: 'Display location full name' },
            native: { id: 'current.display_location.full' }
        });
        adapter.setObjectNotExists('current.display_location.latitude', {
            type: 'state',
            common: { name: 'Display location latitude', role: 'value.latitude', type: 'number', unit: '°', read: true, write: false },
            native: { id: 'current.display_location.latitude' }
        });
        adapter.setObjectNotExists('current.display_location.longitude', {
            type: 'state',
            common: { name: 'Display location longitude', role: 'value.longitude', type: 'number', unit: '°', read: true, write: false },
            native: { id: 'current.display_location.longitude' }
        });
        adapter.setObjectNotExists('current.display_location.elevation', {
            type: 'state',
            common: { name: 'Display location elevation', role: 'value.elevation', type: 'number', unit: 'm', read: true, write: false },
            native: { id: 'current.display_location.elevation' }
        });

        adapter.setObjectNotExists('current.observation_location.full', {
            type: 'state',
            common: { name: 'Observation location full name' },
            native: { id: 'current.observation_location.full' }
        });
        adapter.setObjectNotExists('current.observation_location.latitude', {
            type: 'state',
            common: { name: 'Observation location latitude', role: 'value.latitude', type: 'number', unit: '°', read: true, write: false },
            native: { id: 'current.observation_location.latitude' }
        });
        adapter.setObjectNotExists('current.observation_location.longitude', {
            type: 'state',
            common: { name: 'Observation location longitude', role: 'value.longitude', type: 'number', unit: '°', read: true, write: false },
            native: { id: 'current.observation_location.longitude' }
        });
        adapter.setObjectNotExists('current.observation_location.elevation', {
            type: 'state',
            common: { name: 'Observation location elevation', role: 'value.elevation', type: 'number', unit: 'm', read: true, write: false },
            native: { id: 'current.observation_location.elevation' }
        });
        adapter.setObjectNotExists('current.observation_location.station_id', {
            type: 'state',
            common: { name: 'WU station ID', role: 'id', type: 'string', read: true, write: false },
            native: { id: 'current.observation_location.station_id' }
        });

        adapter.setObjectNotExists('current.local_time_rfc822', {
            type: 'state',
            common: { name: 'Local time (rfc822)', role: 'time', type: 'string', read: true, write: false },
            native: { id: 'current.local_time_rfc822' }
        });
        adapter.setObjectNotExists('current.observation_time_rfc822', {
            type: 'state',
            common: { name: 'Observation time (rfc822)', role: 'time', type: 'string', read: true, write: false },
            native: { id: 'current.observation_time_rfc822' }
        });
        adapter.setObjectNotExists('current.weather', {
            type: 'state',
            common: { name: 'Weather (engl.)', type: 'string', read: true, write: false },
            native: { id: 'current.weather' }
        });
        adapter.setObjectNotExists('current.temp_c', {
            type: 'state',
            common: { name: 'Temperature', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false },
            native: { id: 'current.temp_c' }
        });
        adapter.setObjectNotExists('current.relative_humidity', {
            type: 'state',
            common: { name: 'Relative humidity', role: 'value.humidity', type: 'number', unit: '%', read: true, write: false },
            native: { id: 'current.relative_humidity' }
        });
        adapter.setObjectNotExists('current.wind_degrees', {
            type: 'state',
            common: { name: 'Wind direction', role: 'value.winddir', type: 'number', unit: '°', read: true, write: false },
            native: { id: 'current.wind_degrees' }
        });
        adapter.setObjectNotExists('current.wind_kph', {
            type: 'state',
            common: { name: 'Wind speed', role: 'value.wind', type: 'number', unit: 'km/h', read: true, write: false },
            native: { id: 'current.wind_kph' }
        });
        adapter.setObjectNotExists('current.wind_gust_kph', {
            type: 'state',
            common: { name: 'Wind gust', role: 'value.wind', type: 'number', unit: 'km/h', read: true, write: false },
            native: { id: 'current.wind_gust_kph' }
        });
        adapter.setObjectNotExists('current.pressure_mb', { //PDE
            type: 'state',
            common: { name: 'Air pressure (mbar)', role: 'value.pressure', type: 'number', unit: 'mbar', read: true, write: false },
            native: { id: 'current.pressure_mb' }
        });
        adapter.setObjectNotExists('current.dewpoint_c', {
            type: 'state',
            common: { name: 'Dewpoint', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false },
            native: { id: 'current.dewpoint_c' }
        });
        adapter.setObjectNotExists('current.windchill_c', {
            type: 'state',
            common: { name: 'Windchill', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false },
            native: { id: 'current.windchill_c' }
        });
        adapter.setObjectNotExists('current.feelslike_c', {
            type: 'state',
            common: { name: 'Temperature feels like', role: 'value.temperature', type: 'number', unit: '°C', read: true, write: false },
            native: { id: 'current.feelslike_c' }
        });
        adapter.setObjectNotExists('current.visibility_km', {
            type: 'state',
            common: { name: 'Visibility', role: 'value.distance', type: 'number', unit: 'km', read: true, write: false },
            native: { id: 'current.visibility_km' }
        });
        adapter.setObjectNotExists('current.solarradiation', {
            type: 'state',
            common: { name: 'Solar radiation', role: 'value.radiation', type: 'number', unit: 'w/m2', read: true, write: false },
            native: { id: 'current.solarradiation' }
        });
        adapter.setObjectNotExists('current.UV', {
            type: 'state',
            common: { name: 'UV-Index', role: 'value.index', type: 'number', read: true, write: false },
            native: { id: 'current.UV' }
        });
        adapter.setObjectNotExists('current.precip_1hr_metric', {
            type: 'state',
            common: { name: 'Precipitation (last 1h)', role: 'value.rain', type: 'number', unit: 'mm', read: true, write: false },
            native: { id: 'current.precip_1hr_metric' }
        });
        adapter.setObjectNotExists('current.precip_today_metric', {
            type: 'state',
            common: { name: 'Precipitation (today)', role: 'value.rain', type: 'number', unit: 'mm', read: true, write: false },
            native: { id: 'current.precip_today_metric' }
        });
        adapter.setObjectNotExists('current.icon_url', {
            type: 'state',
            common: { name: 'URL to current weather icon', role: 'url.icon', type: 'string', read: true, write: false },
            native: { id: 'current.icon_url' }
        });
        adapter.setObjectNotExists('current.forecast_url', {
            type: 'state',
            common: { name: 'URL to wu-forecast page', role: 'url.page', type: 'string', read: true, write: false },
            native: { id: 'current.forecast_url' }
        });
        adapter.setObjectNotExists('current.history_url', {
            type: 'state',
            common: { name: 'URL to wu-history page', role: 'url.page', type: 'string', read: true, write: false },
            native: { id: 'current.history_url' }
        });
    }

    adapter.log.debug("init forecast objects");

    if (adapter.config.forecast_periods_txt == true) {
        adapter.setObjectNotExists('forecast_period', {
            type: 'channel',
            role: 'forecast',
            common: { name: 'next 8 day / night periods forecast with icon and text' },
            native: { location: adapter.config.location }
        });


        for (var d = 0; d < 8; d++) {
            var id = "forecast_period." + d + "p.";
            adapter.setObjectNotExists('forecast_period.' + d + 'p', {
                type: 'channel',
                role: 'forecast',
                common: { name: 'in ' + d + 'periods' },
                native: { location: adapter.config.location }
            });
            adapter.setObjectNotExists(id + 'period', {
                type: 'state',
                common: { name: 'forecast for', type: 'string', read: true, write: false },
                native: { id: id + 'period' }
            });
            adapter.setObjectNotExists(id + 'icon', {
                type: 'state',
                common: { name: 'icon', type: 'string', role: 'value.icon', unit: '', read: true, write: false },
                native: { id: id + 'icon' }
            });
            adapter.setObjectNotExists(id + 'icon_URL', {
                type: 'state',
                common: { name: 'icon_url', type: 'string', role: 'value.icon_url', unit: '', read: true, write: false },
                native: { id: id + 'icon_URL' }
            });
            adapter.setObjectNotExists(id + 'title', {
                type: 'state',
                common: { name: 'title', type: 'string', role: 'value.title', unit: '', read: true, write: false },
                native: { id: id + 'title' }
            });
            adapter.setObjectNotExists(id + 'fcttext', {
                type: 'state',
                common: { name: 'fcttext', type: 'string', role: 'value.fcttext', unit: '', read: true, write: false },
                native: { id: id + 'fcttext' }
            });
            adapter.setObjectNotExists(id + 'fcttext_metric', {
                type: 'state',
                common: { name: 'fcttext_metric', type: 'string', role: 'value.fcttext_metric', unit: '', read: true, write: false },
                native: { id: id + 'fcttext_metric' }
            });
            adapter.setObjectNotExists(id + 'pop', {
                type: 'state',
                common: { name: 'pop', type: 'number', role: 'value.pop', unit: '%', read: true, write: false },
                native: { id: id + 'pop' }
            });
        }
    }

    if (adapter.config.forecast_periods == true) {
        adapter.setObjectNotExists('forecast_day', {
            type: 'channel',
            role: 'forecast',
            common: { name: 'next 4 days forecast' },
            native: { location: adapter.config.location }
        });

        for (var p = 0; p < 4; p++) {
            var id = "forecast_day." + p + "d.";
            adapter.setObjectNotExists('forecast_day.' + p + 'd', {
                type: 'channel',
                role: 'forecast',
                common: { name: 'in ' + p + 'days' },
                native: { location: adapter.config.location }
            });
            adapter.setObjectNotExists(id + 'date', {
                type: 'state',
                common: { name: 'forecast for', type: 'string', read: true, write: false },
                native: { id: id + 'date' }
            });
            adapter.setObjectNotExists(id + 'temp.high', {
                type: 'state',
                common: { name: 'high temperature', type: 'number', read: true, write: false },
                native: { id: id + 'temp.high' }
            });
            adapter.setObjectNotExists(id + 'temp.low', {
                type: 'state',
                common: { name: 'low temperature', type: 'number', read: true, write: false },
                native: { id: id + 'temp.high' }
            });
            adapter.setObjectNotExists(id + 'icon', {
                type: 'state',
                common: { name: 'forecast icon', type: 'string', read: true, write: false },
                native: { id: id + 'icon' }
            });
            adapter.setObjectNotExists(id + 'icon_url', {
                type: 'state',
                common: { name: 'forecast icon url', type: 'string', read: true, write: false },
                native: { id: id + 'icon_url' }
            });
            adapter.setObjectNotExists(id + 'pop', {
                type: 'state',
                common: { name: 'Percentage of precipitation', type: 'number', read: true, write: false },
                native: { id: id + 'pop' }
            });
            adapter.setObjectNotExists(id + 'qpf.allday', {
                type: 'state',
                common: { name: 'Quantitative precipitation all day forecast', type: 'number', read: true, write: false },
                native: { id: id + 'qpf.allday' }
            });
            adapter.setObjectNotExists(id + 'qpf.day', {
                type: 'state',
                common: { name: 'Quantitative precipitation day forecast', type: 'number', read: true, write: false },
                native: { id: id + 'qpf.day' }
            });
            adapter.setObjectNotExists(id + 'qpf.night', {
                type: 'state',
                common: { name: 'Quantitative precipitation night forecast', type: 'number', read: true, write: false },
                native: { id: id + 'qpf.night' }
            });

            adapter.setObjectNotExists(id + 'snow.allday', {
                type: 'state',
                common: { name: 'Quantitative snow all day forecast', type: 'number', read: true, write: false },
                native: { id: id + 'snow.allday' }
            });
            adapter.setObjectNotExists(id + 'snow.day', {
                type: 'state',
                common: { name: 'Quantitative snow day forecast', type: 'number', read: true, write: false },
                native: { id: id + 'snow.day' }
            });
            adapter.setObjectNotExists(id + 'snow.night', {
                type: 'state',
                common: { name: 'Quantitative snow night forecast', type: 'number', read: true, write: false },
                native: { id: id + 'snow.night' }
            });

            adapter.setObjectNotExists(id + 'maxwind.kph', {
                type: 'state',
                common: { name: 'max. wind speed', type: 'number', read: true, write: false },
                native: { id: id + 'maxwind.kph' }
            });
            adapter.setObjectNotExists(id + 'maxwind.dir', {
                type: 'state',
                common: { name: 'max. wind direction', type: 'string', read: true, write: false },
                native: { id: id + 'maxwind.dir' }
            });
            adapter.setObjectNotExists(id + 'maxwind.degrees', {
                type: 'state',
                common: { name: 'max. wind direction', type: 'number', read: true, write: false },
                native: { id: id + 'maxwind.degrees' }
            });

            adapter.setObjectNotExists(id + 'avewind.kph', {
                type: 'state',
                common: { name: 'average wind speed', type: 'number', read: true, write: false },
                native: { id: id + 'avewind.kph' }
            });
            adapter.setObjectNotExists(id + 'avewind.dir', {
                type: 'state',
                common: { name: 'average wind direction', type: 'string', read: true, write: false },
                native: { id: id + 'avewind.dir' }
            });
            adapter.setObjectNotExists(id + 'avewind.degrees', {
                type: 'state',
                common: { name: 'average wind direction', type: 'number', read: true, write: false },
                native: { id: id + 'avewind.degrees' }
            });

            adapter.setObjectNotExists(id + 'avehumidity', {
                type: 'state',
                common: { name: 'average humidity', type: 'number', read: true, write: false },
                native: { id: id + 'avehumidity' }
            });
            adapter.setObjectNotExists(id + 'maxhumidity', {
                type: 'state',
                common: { name: 'maximum humidity', type: 'number', read: true, write: false },
                native: { id: id + 'maxhumidity' }
            });
            adapter.setObjectNotExists(id + 'minhumidity', {
                type: 'state',
                common: { name: 'minimum humidity', type: 'number', read: true, write: false },
                native: { id: id + 'minhumidity' }
            });
        }
    }

    if (adapter.config.forecast_hourly == true) {
        adapter.setObjectNotExists('forecast', {
            type: 'channel',
            role: 'forecast',
            common: { name: 'next 24h forecast' },
            native: { location: adapter.config.location }
        });

        for (var h = 0; h < 36; h++) {
            var id = "forecast." + h + "h.";
            adapter.setObjectNotExists('forecast.' + h + 'h', {
                type: 'channel',
                role: 'forecast',
                common: { name: 'in ' + h + 'h' },
                native: { location: adapter.config.location }
            });
            adapter.setObjectNotExists(id + 'time', {
                type: 'state',
                common: { name: 'forecast for', type: 'string', read: true, write: false },
                native: { id: id + 'time' }
            });
            adapter.setObjectNotExists(id + 'temp', {
                type: 'state',
                common: { name: 'Temperature', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false },
                native: { id: id + 'temp' }
            });
            adapter.setObjectNotExists(id + 'fctcode', {
                type: 'state',
                common: { name: 'forecast description code', type: 'number', read: true, write: false },
                native: { id: id + 'fctcode' }
            });
            adapter.setObjectNotExists(id + 'sky', {
                type: 'state',
                common: { name: 'Sky (clear..covered)', type: 'number', unit: '%', read: true, write: false },
                native: { id: id + 'sky' }
            });
            adapter.setObjectNotExists(id + 'wspd', {
                type: 'state',
                common: { name: 'Windspeed', type: 'number', role: 'value.wind', unit: 'km/h', read: true, write: false },
                native: { id: id + 'wspd' }
            });
            adapter.setObjectNotExists(id + 'wdir', {
                type: 'state',
                common: { name: 'Wind direction', type: 'number', role: 'value.winddir', unit: '°', read: true, write: false },
                native: { id: id + 'wdir' }
            });
            adapter.setObjectNotExists(id + 'uvi', {
                type: 'state',
                common: { name: 'UV Index (0..~10)', type: 'number', role: 'value.index', read: true, write: false },
                native: { id: id + 'uvi' }
            });
            adapter.setObjectNotExists(id + 'humidity', {
                type: 'state',
                common: { name: 'Humidity', type: 'number', role: 'value.humidity', unit: '%', read: true, write: false },
                native: { id: id + 'humidity' }
            });
            adapter.setObjectNotExists(id + 'heatindex', {
                type: 'state',
                common: { name: 'Heatindex', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false },
                native: { id: id + 'heatindex' }
            });
            adapter.setObjectNotExists(id + 'feelslike', {
                type: 'state',
                common: { name: 'Feels like', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false },
                native: { id: id + 'feelslike' }
            });
            adapter.setObjectNotExists(id + 'qpf', {
                type: 'state',
                common: { name: 'Quantitative precipitation forecast', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false },
                native: { id: id + 'qpf' }
            });
            adapter.setObjectNotExists(id + 'snow', {
                type: 'state',
                common: { name: 'Snow precipitation', type: 'number', role: 'value.snow', unit: 'mm', read: true, write: false },
                native: { id: id + 'snow' }
            });
            adapter.setObjectNotExists(id + 'pop', {
                type: 'state',
                common: { name: 'Percentage of precipitation', type: 'number', role: 'value.rain', unit: '%', read: true, write: false },
                native: { id: id + 'pop' }
            });
            adapter.setObjectNotExists(id + 'mslp', {
                type: 'state',
                common: { name: 'Mean sea level pressure', type: 'number', role: 'value.pressure', unit: 'hPa', read: true, write: false },
                native: { id: id + 'mslp' }
            });
        }

        adapter.setObjectNotExists('forecast.6h.sum.qpf', {
            type: 'state',
            common: { name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false },
            native: { id: 'forecast.6h.sum.qpf' }
        });
        adapter.setObjectNotExists('forecast.12h.sum.qpf', {
            type: 'state',
            common: { name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false },
            native: { id: 'forecast.12h.sum.qpf' }
        });
        adapter.setObjectNotExists('forecast.24h.sum.qpf', {
            type: 'state',
            common: { name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false },
            native: { id: 'forecast.24h.sum.qpf' }
        });

        adapter.setObjectNotExists('forecast.6h.sum.pop', {
            type: 'state',
            common: { name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false },
            native: { id: 'forecast.6h.sum.pop' }
        });
        adapter.setObjectNotExists('forecast.12h.sum.pop', {
            type: 'state',
            common: { name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false },
            native: { id: 'forecast.12h.sum.pop' }
        });
        adapter.setObjectNotExists('forecast.24h.sum.pop', {
            type: 'state',
            common: { name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false },
            native: { id: 'forecast.24h.sum.pop' }
        });

        adapter.setObjectNotExists('forecast.6h.sum.uvi', {
            type: 'state',
            common: { name: 'avg. uvi', type: 'number', role: 'value.index', read: true, write: false },
            native: { id: 'forecast.6h.sum.uvi' }
        });
        adapter.setObjectNotExists('forecast.12h.sum.uvi', {
            type: 'state',
            common: { name: 'avg. uvi', type: 'number', role: 'value.index', read: true, write: false },
            native: { id: 'forecast.12h.sum.uvi' }
        });
        adapter.setObjectNotExists('forecast.24h.sum.uvi', {
            type: 'state',
            common: { name: 'avg. uvi', type: 'number', role: 'value.index', read: true, write: false },
            native: { id: 'forecast.24h.sum.uvi' }
        });
    }
}
