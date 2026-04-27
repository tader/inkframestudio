# Open-Meteo Source

InkFrame Studio includes an Open-Meteo source provider for forecast data and place lookup.

## Configure Source

1. Open `Config > Sources`.
2. Add `Open-Meteo`.
3. Search for a place by city or postal code.
4. Click `Add` on the matching result. This writes a place entry to `Places JSON`.
5. Save the provider.
6. In `Config > Project`, set `Default source provider` to the Open-Meteo provider.

A place entry is plain JSON, so it can also be edited by hand:

```json
[
  {
    "id": "den-hoorn",
    "name": "Den Hoorn",
    "latitude": 52.002,
    "longitude": 4.331,
    "timezone": "auto"
  }
]
```

API calls are cached for 10 minutes per URL. This cache is generic and used by the Open-Meteo provider for both forecast and place-search requests.

## Query Forecast Data

Forecasts are queried through the generic `data_query` layout node. The Open-Meteo implementation uses `queryKind: "weather_forecast"`.

Minimal query:

```json
{
  "type": "data_query",
  "id": "weather-now",
  "queryKind": "weather_forecast",
  "variableName": "weather",
  "locationId": "den-hoorn",
  "current": ["temperature_2m", "weather_code"],
  "forecastDays": 1,
  "child": {
    "type": "script",
    "id": "weather-script",
    "source": "const now = weather[0]?.current ?? {}; return { temp: Math.round(now.temperature_2m), code: Number(now.weather_code ?? 0) };",
    "child": {
      "type": "primitive_instance",
      "id": "weather-temp",
      "primitiveType": "text",
      "props": {
        "text": "{{temp}}.0",
        "fontRole": "header",
        "horizontalAlign": "center"
      }
    }
  }
}
```

The query result is exposed as an array named by `variableName`. The first item has:

```js
weather[0].current
weather[0].hourly
weather[0].daily
weather[0].raw
```

You can also bypass configured places and pass coordinates directly:

```json
{
  "type": "data_query",
  "id": "weather-now",
  "queryKind": "weather_forecast",
  "variableName": "weather",
  "latitude": 52.002,
  "longitude": 4.331,
  "timezone": "auto",
  "current": "temperature_2m,weather_code"
}
```

## Portrait Weather Display

For a small 128x296 portrait display like the reference image:

1. Create or select a 128x296 display type.
2. Create a layout for that display.
3. Use a `data_query` node as the root.
4. Inside it, use a `script` node to turn `weather[0].current` into:
   - `temp`: rounded temperature
   - `place`: short place name
   - `icon`: Font Awesome icon id from `weather_code`
5. Use a vertical stack with:
   - small text for place
   - large text or number for temperature
   - icon primitive for weather condition

Example script:

```js
const current = weather[0]?.current ?? {};
const code = Number(current.weather_code ?? 0);
const icon =
  code === 0 ? "fa-regular:sun" :
  [1, 2, 3].includes(code) ? "fa-solid:cloud-sun" :
  [45, 48].includes(code) ? "fa-solid:smog" :
  [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code) ? "fa-solid:cloud-rain" :
  [71, 73, 75, 77, 85, 86].includes(code) ? "fa-regular:snowflake" :
  [95, 96, 99].includes(code) ? "fa-solid:cloud-bolt" :
  "fa-solid:cloud";

return {
  place: "Den Hoorn",
  temp: Math.round(Number(current.temperature_2m ?? 0)),
  icon
};
```

Use text template `{{temp}}.0` for a whole-number style like `16.0`, or `{{temp}}°` when using a font with a degree glyph.
