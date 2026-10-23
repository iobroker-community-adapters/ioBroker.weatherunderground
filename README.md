![Logo](admin/wu.png)
# ioBroker.weatherunderground

![Number of Installations](https://iobroker.live/badges/weatherunderground-installed.svg)
![Number of Installations](https://iobroker.live/badges/weatherunderground-stable.svg)
[![NPM version](https://img.shields.io/npm/v/iobroker.weatherunderground.svg)](https://www.npmjs.com/package/iobroker.weatherunderground)

![Test and Release](https://github.com/iobroker-community-adapters/iobroker.weatherunderground/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/weatherunderground/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.weatherunderground.svg)](https://www.npmjs.com/package/iobroker.weatherunderground)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)!

ioBroker adapter for current observations, up to 36 hours of hourly forecasts and six daily forecasts for your location from [Weather Underground](https://www.wunderground.com/).
The adapter retrieves daily and hourly forecast data once per hour by default. The schedule can be changed in the instance settings.

## Requirements

For the current development version:

- Node.js **22 or newer**
- js-controller **6.0.11 or newer**
- Admin **7.7.22 or newer**

## Notes

An official PWS owner API key is optional. With a configured station and current observations enabled, it is used for PWS observations. Forecasts, current weather descriptions/icons and air quality use the website key extracted from Weather Underground, even when an owner key is supplied. Leaving the owner key empty also uses the website key for observations. Availability of that key and the individual products is controlled by the provider.

## Configuration

The instance settings use JSON Config. The new API-key field is encrypted in storage and protected from ordinary foreign-adapter access. Existing keys are transferred automatically to this field; no separate migration command or key re-entry is needed.

Station settings appear when current observations are enabled. Choose an icon set or select Custom to enter an icon base URL and format. Hidden fields retain their values. When the location is empty, the dialog uses the system coordinates and selects non-metric units if the system uses Fahrenheit. A saved location and its units remain unchanged.

## Automatic API-key migration

Released versions stored the key in `apikey`. This version uses `apiKey`, declared in both `encryptedNative` and `protectedNative`. The old field is retained during the upgrade so it cannot be mistaken for ciphertext.

On the first adapter start, the adapter transfers the old key using the controller configuration API. The controller encrypts `apiKey` and clears `apikey` in the same configuration write; weather requests wait until migration is complete. Opening settings before that start also transfers the key into the new field in the form. Saving uses Admin encryption and clears the old field in the same save. An empty key remains empty, and completed migrations are not repeated.

Until that first start or settings save, the legacy field keeps its previous plaintext storage and access behavior. Disabled instances are migrated when they are first started or their settings are saved.

If both fields contain different nonempty keys, neither is discarded automatically. Migration failures stop weather requests and produce a message without key values. Do not edit an old configuration dialog across an adapter upgrade; reopen it after upgrading.

Keep an ioBroker backup before upgrading. For rollback, restore that backup together with the old adapter version: the old version reads only `apikey`. Manually encrypted keys from modified or unreleased versions require their original encryption metadata; they cannot be identified reliably after an upgrade has overwritten that metadata.

## Weather descriptions

- `forecast.current.weather` contains the localized current weather description, such as "Cloudy/Wind". It comes from Weather Company's geocode-based current conditions, using the coordinates returned by the station observation. Temperature, humidity, wind and other measurements still come from the configured PWS; the description can represent a different observation time and source.
- `forecast.current.iconURL` uses the icon code from the same optional current-conditions response; without a valid code it is `null`.
- `forecast.current.airQualityIndex` contains the numeric EPA air quality index for the station coordinates, obtained through Weather Company location resolution and its separate air-quality product. This is an index, not a pollutant concentration or a measurement from the PWS. Missing, invalid or unavailable air-quality data produces `null`.
- `forecast.0d.state` through `forecast.5d.state` keep the complete daily forecast narrative.
- `forecast.0d.stateShort` through `forecast.5d.stateShort` contain the short forecast description. Each uses the same daytime or remaining nighttime period as the corresponding narrative and icon. A provider response without a supported short description produces `null`.

Descriptions use the existing language setting. With current conditions enabled, the adapter makes optional requests for the weather description and air quality (including location resolution) per run using the website key already extracted by the adapter. Missing coordinates, an unavailable key, a rejected request or a missing description leave `forecast.current.weather` as `null` when current observations are processed; they do not discard the PWS measurements or forecasts. A forecast is never substituted for current conditions. Website-key availability is controlled by the provider.

`forecastHourly.0h` is displayed as "Next hourly forecast"; its ID and first hourly forecast values are unchanged. `0h` is the first API response index, not midnight or necessarily the current hour; `.time` gives its forecast timestamp. Existing custom channel names are preserved.

## Development build

Use Node.js 22.12 or newer within the supported runtime range for source builds; the Vite build tooling has a higher minimum than the adapter runtime. The CI build/check job uses Node.js 24; adapter tests also cover Node.js 22 and 26.

The configuration UI sources are in `admin/src/`. As in ioBroker Admin, generated `admin/custom/` files are ignored by Git and must not be committed. After `npm ci`, run `npm run build` before testing, packing or locally uploading the adapter. CI builds the UI before adapter tests; `prepublishOnly` rebuilds it before npm publication. The published npm package includes the generated UI and its assets, so installed users do not need build tools. For a source/Git installation, first run `npm ci`, `npm run build` and `npm pack` in the source checkout, then install the resulting tarball with ioBroker. An unbuilt Git checkout has no generated configuration UI.

## Icon Sets

The adapter currently uses the new Weather Company API, which returns numeric icon codes. All built-in selections **A–K use the same v4 SVG icons** with this API; switching between A–K does not change their appearance. The selections remain compatible with saved configuration.

For example, code `32` produces [32.svg](https://www.wunderground.com/static/i/c/v4/32.svg). The settings preview uses representative numeric icons from the same set.

For your own icons, select **Custom**, enter the base URL and choose GIF, PNG or SVG. Host a file for each numeric code returned by the provider; for example:

| Setting | Example |
| --- | --- |
| Custom Icon-Base-URL | `https://example.com/weather-icons/` |
| Format | PNG |
| Result for code 32 | `https://example.com/weather-icons/32.png` |

The preview samples codes `0`, `12`, `26` and `32`; these are examples, not the complete set of required files. Custom icons are hosted and maintained by their owner.

The old A–K directories contain named legacy files such as `clear.gif` and `nt_clear.gif`. They are not suitable as Custom base URLs for the current API: `https://www.wunderground.com/static/i/c/a/32.svg`, for example, returns Access Denied. The adapter does not translate numeric codes into legacy filenames. Handling of named files is retained for legacy responses, but the current runtime uses the new API.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
- (reloxx13) Refresh documented requirements, forecast coverage, API-key usage and build instructions
- (reloxx13) Display the first hourly forecast as "Next hourly forecast" while preserving its 0h ID and custom channel names
- (reloxx13) Correct weather state roles and update existing object roles without changing IDs, types, units or user metadata (#328)
- (reloxx13) Fix numeric weather icon URLs and align the settings preview (#216)
- (reloxx13) Add the current EPA air quality index without replacing PWS measurements (#220)
- (reloxx13) Add localized current weather descriptions and separate short daily forecast descriptions while preserving PWS measurements and full narratives (#388)
- (reloxx13) End failed or stalled initialization reliably and cancel startup delays and provider requests during shutdown (#224)
- (reloxx13) Automatically migrate existing API keys to a new encrypted and protected configuration field
- (reloxx13) Replace the legacy settings dialog with JSON Config and preserve existing translations and options
- (reloxx13) Correct hourly forecast provider paths for metric and non-metric units
- (reloxx13) Limit the npm package to runtime and configuration assets and enable shared ESLint checks in CI
- (reloxx13) Fix hourly forecast requests using the supported endpoint and current station coordinates (#497)
- (reloxx13) Skip the unused PWS dashboard request when using the new API (#498)
- (reloxx13) Populate hourly forecast weather codes, including code zero (#499)
- (reloxx13) Use calendar-day minimum and maximum forecast temperatures (#500)
- (reloxx13) Correct the documented default refresh interval to once per hour (#501)
- (copilot) Adapter requires node.js >= 22 now
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires js-controller >= 6.0.11 now

### 3.7.0 (2024-04-13)
* (mcm1957) Adapter requires node.js 18 and js-controller >= 5 now
* (mcm1957) Dependencies have been updated

### 3.6.0 (2023-09-09)
* (mcm1957) Icon urls at admin ui have been adapted to weatherunderground website changes (#158)
* (mcm1957) Forecast periods have been extended

### 3.5.0 (2023-09-08)
* (mcm1957) Adapter now requires node 16 or newer
* (mcm1957) Dependencies have been updated
* (waldmensch1) Cloudcover states have been added (PR #178)
* (mcm1957) Date format has been fixed to avoid incorrect display with newer admin versions (#191)
* (mcm1957) Forecast urls have been adapted to weatherunderground website changes (#158)

### 3.4.3 (2023-08-15)
* (Aplollon77) Translations have been updated (#159)
* (mcm1957) The testenvironment has been updated to use node 16/18/20
* (bluefox) Dependencies have been updated

### 3.4.2 (2022-04-26)
* (Apollon77) Added special logging when no current observation data are available because Station most likely offline to reduce confusion

### 3.4.1 (2022-03-13)
* (bluefox) Use axios for communication
* (bluefox) make sure date states are filled correctly

### 3.4.0 (2022-03-10)
* (Apollon77) If no official API-Key is used: Move schedule if default is used to better spread the requests over time to prevent peaks; Additionally add a random delay in the start minute
* (Apollon77) Further optimizations and additional logging

### 3.3.1 (2021-06-28)
* (Apollon77) Optimize for js-controller 3.3

### 3.3.0 (2021-01-22)
* (Apollon77) Optimize for js-controller 3.2
* (Apollon77) js-controller 2.0 is now required at least

### 3.2.5 (2020-12-27)
* (Apollon77) Prevent crash case (Sentry IOBROKER-WEATHERUNDERGROUND-1, IOBROKER-WEATHERUNDERGROUND-2)

### 3.2.3 (2020-12-26)
* (Apollon77) make sure adapter do not crash when no data could be read
* (Apollon77) Add Sentry error reporting

### 3.2.2 (2020-12-02)
* (Apollon77) icons sometimes did not have a correct extension
* (Apollon77) Correct some cases with different types of locations when reading data

### 3.2.1
* (raintonr) Corrected 'Imperial' terminology.

### 3.2.0 (2019-12-28)
* (StrathCole) fix forecast expiry time
* (StrathCole) add visibility index to objects on hourly forecast

### 3.1.6 (2019-10-16)
* (Bjoern3003) adjust to WU changes, now v3 API for hourly data
* (Apollon77) run once after installation/update

### 3.1.3
* (Apollon77) text correction

### 3.1.2 (2019-07-27)
* (Apollon77) use new parameters to get decimal precision values

### 3.1.1 (2019-07-14)
* (Apollon77) add windDirection as string calculated based on degrees

### 3.1.0 (2019-07-12)
* (Apollon77) remove option for legacy API because disabled by WU

### 3.0.14 (2019-07-11)
* (Apollon77) optimize checking of pws station id

### 3.0.13 (2019-07-10)
* (Apollon77) Fix error in image url handling

### 3.0.12 (2019-07-09)
* (Apollon77) Re-Fetch PWS station key on Error 401

### 3.0.11 (2019-06-04)
* (Apollon77) Use a fallback ID after the dashboard fallback page became unavailable

### 3.0.10 (2019-05-27)
* (Apollon77) Adopt logic to WU changes

### 3.0.8 (2019-03-23)
* (Apollon77) Add additional guidance when location is not found by WU

### 3.0.7 (2019-03-22)
* (Apollon77) implement to extract used "legacy" API keys out of WU website to allow restore of functionality for now
* (Apollon77) Also extract API keys for newer API version from website to be usable together with real "PWS owner keys" in future
* (Apollon77) optionally get data using the New APIs (as well as the officially available PWS-Owner APIs as also additional ones to restore functionality)
* (Apollon77) Admin 2 support removed and adapted the Admin 3 texts as needed for now

### 2.0.4 (2018-08-19)
* (René) some typos
* (bluefox) Write only numbers and not strings

### 2.0.3 (2018-07-30)
* (bluefox) Warning! Breaking changes! States are renamed.
* (bluefox) Refactoring of states and roles

### 1.1.2 (2017-11-24)
* (Apollon77) Add option to specify image format for custom image urls

### 1.1.1 (2017-11-08)
* (Apollon77) Optimize API usage by getting all data with one call instead of two
* (Apollon77) Add support for multiple API-Keys

### 1.1.0 (2017-10-30)
* (Apollon77) Add option to overwrite Icon Base URL

### 1.0.8 (2017-07-12)
* (DeepCoreSystem) add 2 current observation values, fixes of some datapoint caps.

### 1.0.7 (2017-06-19)
* (Dutchman) add Dutch language suppport

### 1.0.6 (2017-05-16)
* (Rene) bug fixing
	+ all 4 sets are enabled as default
	+ change of checkbox enables saves button

### 1.0.5 (2017-05-14)
* (Rene) hourly forecast extend to 36h

### 1.0.4 (2017-04-09)
* (Rene) parse much more data
   + today's 24 h
   + next 4 days / nights as text
   + next 4 days
   + current values
   each can be enabled or disabled

### 1.0.3 (2016-11-01)
* (bluefox) Catch parse errors

### 1.0.2 (2016-10-29)
* (Apollon77) make sure precip values are always integers

### 1.0.1 (2016-07-21)
* (jens-maus) conversion from feet to meter for observation_location

### 1.0.0 (2016-07-12)
* (Apollon77) add daily rain level forecast

### 0.2.0 (2016-07-01)
* (Apollon77) Add Error handling and station-usage for forcasts

### 0.1.1 (2016-06-07)
* (ploebb) Fix forecast api URL

### 0.1.0 (2016-05-07)
* (bluefox) convert text to floats
* (bluefox) support languages

### 0.0.5
corrected humidity value within current weather info (slice + unit)

### 0.0.4
checking for spaces in location
added current conditions

### 0.0.3
bugfix in summed pop-value.

### 0.0.2
config dialog fixed

### 0.0.1
initial release with all basics to load WU-forecast data

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

The MIT License (MIT)

Copyright (c) 2024-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2015-2023 dschaedl <daniel.schaedler@gmail.com>, iobroker-community-adapters

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
