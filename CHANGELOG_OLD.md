# Older changes
## 3.4.3 (2023-08-15)
* (Aplollon77) Translations have been updated (#159)
* (mcm1957) The testenvironment has been updated to use node 16/18/20
* (bluefox) Dependencies have been updated

## 3.4.2 (2022-04-26)
* (Apollon77) Added special logging when no current observation data are available because Station most likely offline to reduce confusion

## 3.4.1 (2022-03-13)
* (bluefox) Use axios for communication
* (bluefox) make sure date states are filled correctly

## 3.4.0 (2022-03-10)
* (Apollon77) If no official API-Key is used: Move schedule if default is used to better spread the requests over time to prevent peaks; Additionally add a random delay in the start minute
* (Apollon77) Further optimizations and additional logging

## 3.3.1 (2021-06-28)
* (Apollon77) Optimize for js-controller 3.3

## 3.3.0 (2021-01-22)
* (Apollon77) Optimize for js-controller 3.2
* (Apollon77) js-controller 2.0 is now required at least

## 3.2.5 (2020-12-27)
* (Apollon77) Prevent crash case (Sentry IOBROKER-WEATHERUNDERGROUND-1, IOBROKER-WEATHERUNDERGROUND-2)

## 3.2.3 (2020-12-26)
* (Apollon77) make sure adapter do not crash when no data could be read
* (Apollon77) Add Sentry error reporting

## 3.2.2 (2020-12-02)
* (Apollon77) icons sometimes did not have a correct extension
* (Apollon77) Correct some cases with different types of locations when reading data

## 3.2.1
* (raintonr) Corrected 'Imperial' terminology.

## 3.2.0 (2019-12-28)
* (StrathCole) fix forecast expiry time
* (StrathCole) add visibility index to objects on hourly forecast

## 3.1.6 (2019-10-16)
* (Bjoern3003) adjust to WU changes, now v3 API for hourly data
* (Apollon77) run once after installation/update

## 3.1.3
* (Apollon77) text correction

## 3.1.2 (2019-07-27)
* (Apollon77) use new parameters to get decimal precision values

## 3.1.1 (2019-07-14)
* (Apollon77) add windDirection as string calculated based on degrees

## 3.1.0 (2019-07-12)
* (Apollon77) remove option for legacy API because disabled by WU

## 3.0.14 (2019-07-11)
* (Apollon77) optimize checking of pws station id

## 3.0.13 (2019-07-10)
* (Apollon77) Fix error in image url handling

## 3.0.12 (2019-07-09)
* (Apollon77) Re-Fetch PWS station key on Error 401

## 3.0.11 (2019-06-04)
* (Apollon77) Use a fallback ID after the dashboard fallback page became unavailable

## 3.0.10 (2019-05-27)
* (Apollon77) Adopt logic to WU changes

## 3.0.8 (2019-03-23)
* (Apollon77) Add additional guidance when location is not found by WU

## 3.0.7 (2019-03-22)
* (Apollon77) implement to extract used "legacy" API keys out of WU website to allow restore of functionality for now
* (Apollon77) Also extract API keys for newer API version from website to be usable together with real "PWS owner keys" in future
* (Apollon77) optionally get data using the New APIs (as well as the officially available PWS-Owner APIs as also additional ones to restore functionality)
* (Apollon77) Admin 2 support removed and adapted the Admin 3 texts as needed for now

## 2.0.4 (2018-08-19)
* (René) some typos
* (bluefox) Write only numbers and not strings

## 2.0.3 (2018-07-30)
* (bluefox) Warning! Breaking changes! States are renamed.
* (bluefox) Refactoring of states and roles

## 1.1.2 (2017-11-24)
* (Apollon77) Add option to specify image format for custom image urls

## 1.1.1 (2017-11-08)
* (Apollon77) Optimize API usage by getting all data with one call instead of two
* (Apollon77) Add support for multiple API-Keys

## 1.1.0 (2017-10-30)
* (Apollon77) Add option to overwrite Icon Base URL

## 1.0.8 (2017-07-12)
* (DeepCoreSystem) add 2 current observation values, fixes of some datapoint caps.

## 1.0.7 (2017-06-19)
* (Dutchman) add Dutch language suppport

## 1.0.6 (2017-05-16)
* (Rene) bug fixing
	+ all 4 sets are enabled as default
	+ change of checkbox enables saves button

## 1.0.5 (2017-05-14)
* (Rene) hourly forecast extend to 36h

## 1.0.4 (2017-04-09)
* (Rene) parse much more data
   + today's 24 h
   + next 4 days / nights as text
   + next 4 days
   + current values
   each can be enabled or disabled

## 1.0.3 (2016-11-01)
* (bluefox) Catch parse errors

## 1.0.2 (2016-10-29)
* (Apollon77) make sure precip values are always integers

## 1.0.1 (2016-07-21)
* (jens-maus) conversion from feet to meter for observation_location

## 1.0.0 (2016-07-12)
* (Apollon77) add daily rain level forecast

## 0.2.0 (2016-07-01)
* (Apollon77) Add Error handling and station-usage for forcasts

## 0.1.1 (2016-06-07)
* (ploebb) Fix forecast api URL

## 0.1.0 (2016-05-07)
* (bluefox) convert text to floats
* (bluefox) support languages

## 0.0.5
corrected humidity value within current weather info (slice + unit)

## 0.0.4
checking for spaces in location
added current conditions

## 0.0.3
bugfix in summed pop-value.

## 0.0.2
config dialog fixed

## 0.0.1
initial release with all basics to load WU-forecast data
