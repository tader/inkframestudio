# Example Screens

These are early wireframes for the first supported display profiles.

Legend:

- `[A]` means accent color text or icon
- all other text and lines render in foreground color
- diagrams are conceptual wireframes, not pixel-perfect mockups

## `tri296x128` Screen Sketches

### 1. Door Status

Use near an entrance or garage.

```text
+-------------------------------------+
| GARAGE                        14:32 |
|                                     |
|   [icon: garage door]               |
|                                     |
|   [A] OPEN                          |
|   since 14:07                       |
|                                     |
|  17.0 C                61% RH       |
+-------------------------------------+
```

### 2. Electricity Price

Best as a dedicated utility display.

```text
+-------------------------------------+
| ELECTRICITY PRICE              Fri  |
|                                     |
|   0.284                            |
|   EUR/kWh          [A] HIGH         |
|                                     |
|   ▁▁▂▂▃▄▅▆▇█▇▆▅▄▃▂▂▁▁▂▃▄▅▅          |
|                 ^ now               |
+-------------------------------------+
```

### 3. Compact Agenda

```text
+-------------------------------------+
| TUE 14 APR                    Week16|
|                                     |
| [A] 09:00  Bike service             |
| 13:15      Daily                    |
| 14:00      Architecture             |
| 17:15      Hockey                   |
|                                     |
| Home       21.0 C          Dry      |
+-------------------------------------+
```

### 4. Climate List

```text
+-------------------------------------+
| ROOMS                         14:32 |
|                                     |
| Office      21.0 C            49%   |
| Bathroom    21.5 C            67%   |
| Garage      14.5 C            75%   |
| Bedroom     19.0 C            54%   |
|                                     |
| Trend: ▁▂▂▃▄▅▅▆                     |
+-------------------------------------+
```

### 5. Full-Screen Word Clock

```text
+-------------------------------------+
| IT IS                               |
|                                     |
| TEN   QUARTER   TWENTY   FIVE       |
| HALF  PAST      TO                  |
| ONE   TWO       THREE    FOUR       |
| FIVE  SIX       SEVEN    EIGHT      |
| NINE  TEN       ELEVEN   TWELVE     |
|                                     |
| [A] TWENTY FIVE PAST TWO            |
+-------------------------------------+
```

## `tri400x300` Screen Sketches

### 1. Home Overview

```text
+----------------------------------------+
| FRI 17 APR  14:32        STATUS OK     |
|----------------------------------------|
| Garage           | Electricity         |
| [A] OPEN 25 min  | 0.284 EUR/kWh HIGH  |
|                  | ▁▁▂▂▃▄▅▆▇█▇▆▅▄▃▂    |
|----------------------------------------|
| Next Agenda                             |
| [A] 15:00 Dentist                       |
| 17:15 Hockey training                   |
| 20:00 Take bins out                     |
|----------------------------------------|
| Rooms                                   |
| Office     21.0 C   49%   stable        |
| Bath       21.5 C   67%   humid         |
| Garage     14.5 C   75%   cold          |
+----------------------------------------+
```

### 2. Energy Detail

```text
+----------------------------------------+
| ELECTRICITY TODAY           Fri        |
|                                        |
|   0.284 EUR/kWh                        |
|   [A] HIGH NOW                         |
|                                        |
|   ▁▁▂▂▃▄▅▆▇█▇▆▅▄▃▂▂▁▁▂▃▄▅▅              |
|                                        |
|   Cheapest later: 02:00-04:00          |
|                                        |
|   Yesterday avg     0.219              |
|   Today avg         0.247              |
|   Import today      8.4 kWh            |
+----------------------------------------+
```

### 3. Combined Clock + Agenda

```text
+----------------------------------------+
| IT IS                                  |
|                                        |
| [A] TEN PAST TWO                       |
|                                        |
|----------------------------------------|
| Today                                   |
| 15:00 Dentist                           |
| 17:15 Hockey training                   |
| 20:00 Take bins out                     |
|----------------------------------------|
| Front door closed   Garage open 25 min |
+----------------------------------------+
```

## Cross-Profile Design Notes

- The same layout definition should be portable only when widgets fit the target grid.
- Accent color semantics stay the same whether accent is red or yellow.
- `tri400x300` should add detail through whitespace and graph width, not by shrinking all text.
- A small display should generally have one hero widget.
- A large display can support one hero area plus two support areas.
