'use client';

import cx from 'classnames';
import { format, isWithinInterval } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { Cloud, Moon, Sun, Sunrise, Sunset } from 'lucide-react';

type WeatherAtLocation = {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  cityName?: string;
  current_units: {
    time: string;
    interval: string;
    temperature_2m: string;
  };
  current: {
    time: string;
    interval: number;
    temperature_2m: number;
  };
  hourly_units: {
    time: string;
    temperature_2m: string;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
  };
  daily_units: {
    time: string;
    sunrise: string;
    sunset: string;
  };
  daily: {
    time: string[];
    sunrise: string[];
    sunset: string[];
  };
};

const SAMPLE: WeatherAtLocation = {
  latitude: 37.763_283,
  longitude: -122.412_86,
  generationtime_ms: 0.027_894_973_754_882_812,
  utc_offset_seconds: 0,
  timezone: 'GMT',
  timezone_abbreviation: 'GMT',
  elevation: 18,
  cityName: 'San Francisco, CA',
  current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C' },
  current: { time: '2024-10-07T19:30', interval: 900, temperature_2m: 29.3 },
  hourly_units: { time: 'iso8601', temperature_2m: '°C' },
  hourly: {
    time: [
      '2024-10-07T00:00',
      '2024-10-07T01:00',
      '2024-10-07T02:00',
      '2024-10-07T03:00',
      '2024-10-07T04:00',
      '2024-10-07T05:00',
      '2024-10-07T06:00',
      '2024-10-07T07:00',
      '2024-10-07T08:00',
      '2024-10-07T09:00',
      '2024-10-07T10:00',
      '2024-10-07T11:00',
      '2024-10-07T12:00',
      '2024-10-07T13:00',
      '2024-10-07T14:00',
      '2024-10-07T15:00',
      '2024-10-07T16:00',
      '2024-10-07T17:00',
      '2024-10-07T18:00',
      '2024-10-07T19:00',
      '2024-10-07T20:00',
      '2024-10-07T21:00',
      '2024-10-07T22:00',
      '2024-10-07T23:00',
      '2024-10-08T00:00',
      '2024-10-08T01:00',
      '2024-10-08T02:00',
      '2024-10-08T03:00',
      '2024-10-08T04:00',
      '2024-10-08T05:00',
      '2024-10-08T06:00',
      '2024-10-08T07:00',
      '2024-10-08T08:00',
      '2024-10-08T09:00',
      '2024-10-08T10:00',
      '2024-10-08T11:00',
      '2024-10-08T12:00',
      '2024-10-08T13:00',
      '2024-10-08T14:00',
      '2024-10-08T15:00',
      '2024-10-08T16:00',
      '2024-10-08T17:00',
      '2024-10-08T18:00',
      '2024-10-08T19:00',
      '2024-10-08T20:00',
      '2024-10-08T21:00',
      '2024-10-08T22:00',
      '2024-10-08T23:00',
      '2024-10-09T00:00',
      '2024-10-09T01:00',
      '2024-10-09T02:00',
      '2024-10-09T03:00',
      '2024-10-09T04:00',
      '2024-10-09T05:00',
      '2024-10-09T06:00',
      '2024-10-09T07:00',
      '2024-10-09T08:00',
      '2024-10-09T09:00',
      '2024-10-09T10:00',
      '2024-10-09T11:00',
      '2024-10-09T12:00',
      '2024-10-09T13:00',
      '2024-10-09T14:00',
      '2024-10-09T15:00',
      '2024-10-09T16:00',
      '2024-10-09T17:00',
      '2024-10-09T18:00',
      '2024-10-09T19:00',
      '2024-10-09T20:00',
      '2024-10-09T21:00',
      '2024-10-09T22:00',
      '2024-10-09T23:00',
      '2024-10-10T00:00',
      '2024-10-10T01:00',
      '2024-10-10T02:00',
      '2024-10-10T03:00',
      '2024-10-10T04:00',
      '2024-10-10T05:00',
      '2024-10-10T06:00',
      '2024-10-10T07:00',
      '2024-10-10T08:00',
      '2024-10-10T09:00',
      '2024-10-10T10:00',
      '2024-10-10T11:00',
      '2024-10-10T12:00',
      '2024-10-10T13:00',
      '2024-10-10T14:00',
      '2024-10-10T15:00',
      '2024-10-10T16:00',
      '2024-10-10T17:00',
      '2024-10-10T18:00',
      '2024-10-10T19:00',
      '2024-10-10T20:00',
      '2024-10-10T21:00',
      '2024-10-10T22:00',
      '2024-10-10T23:00',
      '2024-10-11T00:00',
      '2024-10-11T01:00',
      '2024-10-11T02:00',
      '2024-10-11T03:00',
    ],
    temperature_2m: [
      36.6, 32.8, 29.5, 28.6, 29.2, 28.2, 27.5, 26.6, 26.5, 26, 25, 23.5, 23.9,
      24.2, 22.9, 21, 24, 28.1, 31.4, 33.9, 32.1, 28.9, 26.9, 25.2, 23, 21.1,
      19.6, 18.6, 17.7, 16.8, 16.2, 15.5, 14.9, 14.4, 14.2, 13.7, 13.3, 12.9,
      12.5, 13.5, 15.8, 17.7, 19.6, 21, 21.9, 22.3, 22, 20.7, 18.9, 17.9, 17.3,
      17, 16.7, 16.2, 15.6, 15.2, 15, 15, 15.1, 14.8, 14.8, 14.9, 14.7, 14.8,
      15.3, 16.2, 17.9, 19.6, 20.5, 21.6, 21, 20.7, 19.3, 18.7, 18.4, 17.9,
      17.3, 17, 17, 16.8, 16.4, 16.2, 16, 15.8, 15.7, 15.4, 15.4, 16.1, 16.7,
      17, 18.6, 19, 19.5, 19.4, 18.5, 17.9, 17.5, 16.7, 16.3, 16.1,
    ],
  },
  daily_units: {
    time: 'iso8601',
    sunrise: 'iso8601',
    sunset: 'iso8601',
  },
  daily: {
    time: [
      '2024-10-07',
      '2024-10-08',
      '2024-10-09',
      '2024-10-10',
      '2024-10-11',
    ],
    sunrise: [
      '2024-10-07T07:15',
      '2024-10-08T07:16',
      '2024-10-09T07:17',
      '2024-10-10T07:18',
      '2024-10-11T07:19',
    ],
    sunset: [
      '2024-10-07T19:00',
      '2024-10-08T18:58',
      '2024-10-09T18:57',
      '2024-10-10T18:55',
      '2024-10-11T18:54',
    ],
  },
};

function toInteger(num: number): number {
  return Math.round(num);
}

const safeSlice = <T,>(input: T[], start: number, end: number) => {
  if (!input.length) return [];
  const offset = Math.max(start, 0);
  const target = Math.max(end, offset + 1);
  return input.slice(offset, target);
};

export function Weather({
  weatherAtLocation = SAMPLE,
}: {
  weatherAtLocation?: WeatherAtLocation;
}) {
  const currentTime = useMemo(
    () => new Date(weatherAtLocation.current.time),
    [weatherAtLocation.current.time]
  );
  const isDay = isWithinInterval(currentTime, {
    start: new Date(weatherAtLocation.daily.sunrise[0]),
    end: new Date(weatherAtLocation.daily.sunset[0]),
  });

  const firstDayTemperatures = safeSlice(
    weatherAtLocation.hourly.temperature_2m,
    0,
    24
  );
  const currentHigh =
    firstDayTemperatures.length > 0
      ? Math.max(...firstDayTemperatures)
      : weatherAtLocation.current.temperature_2m;
  const currentLow =
    firstDayTemperatures.length > 0
      ? Math.min(...firstDayTemperatures)
      : weatherAtLocation.current.temperature_2m;

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hoursToShow = isMobile ? 5 : 6;

  const currentTimeIndex = weatherAtLocation.hourly.time.findIndex(
    (time) => new Date(time) >= currentTime
  );
  const fallbackIndex = currentTimeIndex === -1 ? 0 : currentTimeIndex;
  const displayTimes = safeSlice(
    weatherAtLocation.hourly.time,
    fallbackIndex,
    fallbackIndex + hoursToShow
  );
  const displayTemperatures = safeSlice(
    weatherAtLocation.hourly.temperature_2m,
    fallbackIndex,
    fallbackIndex + hoursToShow
  );

  const locationLabel = weatherAtLocation.cityName
    ? weatherAtLocation.cityName
    : `${weatherAtLocation.latitude?.toFixed(1)}°, ${weatherAtLocation.longitude?.toFixed(1)}°`;

  const palette = isDay
    ? {
        foreground: 'text-slate-900',
        muted: 'text-slate-600',
        subtle: 'text-slate-500',
        accent: 'text-sky-600',
      }
    : {
        foreground: 'text-slate-50',
        muted: 'text-slate-300',
        subtle: 'text-slate-400',
        accent: 'text-sky-300',
      };

  return (
    <div className="relative w-full max-w-[28rem] overflow-hidden rounded-3xl border border-border/40 bg-background/95 shadow-xl">
      <div
        aria-hidden="true"
        className={cx(
          'absolute inset-0 opacity-90 transition-colors',
          isDay
            ? 'bg-gradient-to-br from-sky-100 via-sky-200 to-sky-300 dark:from-sky-500/40 dark:via-sky-600/30 dark:to-indigo-800/40'
            : 'bg-gradient-to-br from-slate-900 via-indigo-950 to-black/80'
        )}
      />

      <div className="relative z-10 flex flex-col gap-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p
              className={cx(
                'text-xs font-semibold uppercase tracking-wide',
                palette.subtle
              )}
            >
              Local Weather
            </p>
            <p className={cx('text-lg font-semibold', palette.foreground)}>
              {locationLabel}
            </p>
            <p className={cx('text-xs', palette.muted)}>
              {format(currentTime, 'MMM d • h:mm a')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={cx(
                'rounded-full bg-white/30 p-2 backdrop-blur-sm',
                palette.accent
              )}
            >
              {isDay ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </span>
            <div className="text-right">
              <p
                className={cx(
                  'text-4xl font-semibold leading-none',
                  palette.foreground
                )}
              >
                {toInteger(weatherAtLocation.current.temperature_2m)}
                <span className="ml-1 text-base">
                  {weatherAtLocation.current_units.temperature_2m}
                </span>
              </p>
              <p className={cx('text-xs font-medium', palette.muted)}>
                H: {toInteger(currentHigh)}° • L: {toInteger(currentLow)}°
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl bg-white/25 p-4 backdrop-blur-sm dark:bg-white/10">
          <p
            className={cx(
              'text-xs font-semibold uppercase tracking-wide',
              palette.muted
            )}
          >
            Next hours
          </p>
          <div className="grid grid-cols-5 gap-2 text-center sm:grid-cols-6">
            {displayTimes.map((time, index) => {
              const slotTime = new Date(time);
              const label = index === 0 ? 'Now' : format(slotTime, 'ha');
              const temperature =
                displayTemperatures[index] ??
                weatherAtLocation.current.temperature_2m;

              return (
                <div
                  className="flex flex-col items-center gap-2 rounded-xl border border-white/20 bg-white/10 p-2 text-xs backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                  key={time}
                >
                  <span
                    className={cx(
                      'font-medium uppercase tracking-tight',
                      palette.subtle
                    )}
                  >
                    {label}
                  </span>
                  <Cloud className={cx('h-5 w-5', palette.accent)} />
                  <span
                    className={cx('text-sm font-semibold', palette.foreground)}
                  >
                    {toInteger(temperature)}°
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/15 p-4 text-xs backdrop-blur-sm dark:bg-white/10">
          <div className="flex items-center gap-2">
            <Sunrise className={cx('h-4 w-4', palette.accent)} />
            <span className={palette.muted}>
              Sunrise
              <span className={cx('ml-2 font-semibold', palette.foreground)}>
                {format(new Date(weatherAtLocation.daily.sunrise[0]), 'h:mm a')}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Sunset className={cx('h-4 w-4', palette.accent)} />
            <span className={palette.muted}>
              Sunset
              <span className={cx('ml-2 font-semibold', palette.foreground)}>
                {format(new Date(weatherAtLocation.daily.sunset[0]), 'h:mm a')}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
