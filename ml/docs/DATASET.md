# Dataset

## Overview

The model uses one raw CSV file, `greensite_baghdad_raw.csv` (54.2 MB). We collected it with a Google Earth Engine script (`greensite_raw_dataset_v2.py`, not included in this repository) and the NASA POWER API. The retrieval run and download were done on 8 October 2026.

The original collection notes and the validation output of that script are kept unchanged in `greensite_data_documentation.md` and `validation_report.txt`. The figures below were checked against the CSV itself and against the model notebook output.

| Property | Value |
|---|---|
| Rows | 246,451 |
| Columns | 20 |
| Unique cells | 6,011 |
| Months per cell | 41 (every cell has all of them) |
| Time range | 2023-01-01 to 2026-05-01, monthly |
| Months skipped | none |
| Duplicate (cell, month) rows | 0 |
| Area | Baghdad Governorate (FAO GAUL 2015, level 1) |
| Extent of cell centres | 32.8375° to 33.7708° N, 43.8491° to 44.9654° E |
| Grid | native MODIS MOD13A3 1 km pixel centres |

The table is in long format: one row per cell per month. That is why it has 246,451 rows for only 6,011 locations (6,011 × 41 = 246,451). Static attributes such as soil and land cover repeat in every month of a cell. All sources were sampled at the MODIS cell centres with Earth Engine `reduceRegions` and the `first` reducer. NASA POWER was requested once per POWER grid cell covering Baghdad and joined by cell and month.

## Sources

| Variables | Dataset | Organization | Resolution | Time |
|---|---|---|---|---|
| NDVI and its quality flag | MODIS MOD13A3 v6.1 | NASA / USGS LP DAAC | 1 km | monthly |
| Temperature, dewpoint, precipitation, soil moisture, evaporation | ERA5-Land monthly aggregates | ECMWF / Copernicus | about 9 to 11 km | monthly |
| Relative humidity | NASA POWER RH2M (MERRA-2) | NASA Langley Research Center | 0.5° × 0.625° (about 55 × 60 km) | monthly |
| Soil pH, organic carbon, sand, clay (0 to 5 cm) | SoilGrids 2.0 | ISRIC | 250 m | static |
| Land cover | ESA WorldCover v200 (2021) | ESA | 10 m | static |
| Study area boundary | FAO GAUL 2015, level 1 | FAO | vector | static |

## Data dictionary

| Column | Unit / encoding | Description | Source |
|---|---|---|---|
| `cell_id` | integer | cell identifier (0 to 6,010), join key only | collection script |
| `latitude`, `longitude` | degrees (WGS84) | cell centre | MODIS pixel centre |
| `date` | text, YYYY-MM-DD | first day of the month | |
| `ndvi_raw` | integer, scale 0.0001 (fill value -3000) | monthly NDVI | MOD13A3 |
| `ndvi_summary_qa` | code | quality: 0 good, 1 marginal, 2 snow/ice, 3 cloudy | MOD13A3 |
| `temperature_2m_K` | K | mean air temperature at 2 m | ERA5-Land |
| `dewpoint_2m_K` | K | mean dewpoint at 2 m | ERA5-Land |
| `humidity_rh2m_pct` | % (-999 = POWER missing flag) | mean relative humidity at 2 m | NASA POWER |
| `total_precipitation_m` | m of water | monthly total precipitation | ERA5-Land |
| `soil_moisture_vwc_layer1` | m³/m³ | volumetric soil water, 0 to 7 cm | ERA5-Land |
| `total_evaporation_m` | m (negative = evaporation, ECMWF convention) | monthly total evaporation | ERA5-Land |
| `potential_evaporation_m` | m (same convention) | monthly potential evaporation | ERA5-Land |
| `soil_ph_x10` | pH × 10 | soil pH in H2O, 0 to 5 cm | SoilGrids |
| `soil_organic_carbon_dg_kg` | dg/kg | soil organic carbon, 0 to 5 cm | SoilGrids |
| `sand_g_kg`, `clay_g_kg` | g/kg | sand and clay fraction, 0 to 5 cm | SoilGrids |
| `land_cover_code` | class code | WorldCover class at the cell-centre point | ESA WorldCover 2021 |
| `power_lat`, `power_lon` | degrees | centre of the NASA POWER grid cell used for humidity | collection script |

The raw encodings are kept in the CSV (NDVI × 10,000, kelvin, metres, pH × 10). The model notebook converts only what it uses.

## Transformations in the model notebook

New columns are added and the raw columns are not changed.

| New column | Formula |
|---|---|
| `ndvi` | `ndvi_raw × 0.0001`, applied once, with a guard against double scaling |
| `temperature_c` | `temperature_2m_K − 273.15` |
| `precipitation_mm` | `total_precipitation_m × 1000` |
| `month` | calendar month of `date` |
| `ndvi_ok`, `ndvi_valid` | reliable flag, and NDVI kept only when the quality flag is 0 or 1 |

Soil organic carbon is divided by 10 to give g/kg in the outputs, and pH by 10 when it is reported.

## Value ranges

| Variable | Min | Median | Max |
|---|---|---|---|
| NDVI | -0.059 | 0.239 | 0.754 |
| Temperature (°C, monthly mean) | 9.7 | 26.2 | 40.4 |
| Precipitation (mm, monthly) | 0.016 | 4.81 | 170.2 |
| Relative humidity (%) | 14.0 | | 71.7 |
| Soil pH | 7.7 | | 8.0 |

Mean NDVI by calendar month is highest from January to April (about 0.29 to 0.32) and lowest from July to October (about 0.21). This seasonal swing is the reason the model only compares full 12-month windows.

## Quality checks

| Check | Result |
|---|---|
| Required columns present | yes |
| Month gaps inside a cell | 0 |
| Dates that are not the first of a month | 0 |
| NDVI values outside -1 to 1 | 0 |
| MODIS fill values (-3000) | 0 |
| NASA POWER missing flags (-999) | 0 |
| NDVI quality flags | 0 good: 225,991 (91.7%); 1 marginal: 19,222 (7.8%); 3 cloudy: 1,238 (0.5%); 2 snow/ice: 0 |
| Reliable NDVI share (flag 0 or 1) | 99.5% |
| Cells with at least one unreliable month | 690 |
| One land-cover code per cell | yes |

## Missing values

Only the soil columns have missing values.

| Column | Missing rows | Percent | Cells |
|---|---|---|---|
| `soil_ph_x10` | 29,725 | 12.06% | 725 |
| `soil_organic_carbon_dg_kg` | 29,602 | 12.01% | 722 |
| `sand_g_kg` | 29,725 | 12.06% | 725 |
| `clay_g_kg` | 29,725 | 12.06% | 725 |

756 cells miss at least one of organic carbon, sand or clay. The model uses this as its "soil missing" flag. The missing values are not random. They are concentrated in built-up land: 541 of these 756 cells are built-up, and 529 of the 791 built-up cells have no SoilGrids values at all. The model keeps these cells and rates their preliminary soil potential as "Needs further assessment". Missing soil is never treated as poor soil.

## Land cover

| ESA WorldCover class | Code | Cells | Mean recent NDVI |
|---|---|---|---|
| Cropland | 40 | 2,296 | 0.300 |
| Bare / sparse vegetation | 60 | 1,547 | 0.176 |
| Tree cover | 10 | 809 | 0.337 |
| Built-up | 50 | 791 | 0.154 |
| Shrubland | 20 | 262 | 0.236 |
| Permanent water | 80 | 218 | 0.265 |
| Grassland | 30 | 88 | 0.130 |

The code is a single value at the cell centre. A 1 km cell is usually mixed, and class 50 cannot separate housing, roads and industry.

## Spatial and temporal resolution

NDVI is 1 km and monthly. Soil comes from a 250 m map and land cover from a 10 m map, both static and sampled at the cell centre. The climate variables are much coarser: in any month, ERA5-Land temperature takes at most 74 distinct values across the 6,011 cells, and NASA POWER humidity only 7, one per POWER grid cell. Neighbouring cells therefore share the same climate values, and the model uses climate only as context.

The data covers about 3.4 years. The seasonal baseline therefore uses only 2 to 3 earlier observations for each calendar month (2.41 on average).

## Known issues in the raw data

- Total precipitation has a single value across all cells in September 2024.
- Soil moisture has a minimum of -1.0e-20, which is numerical noise from the source.
- Rainfall differs strongly between the two years used for the change indicator: about 257 mm in the recent 12 months against 120 mm in the previous 12 months.
- Earth Engine dataset IDs other than SoilGrids were not checked against the live catalog, and the values were not compared with the original sources.

## Data sources and attribution

Each source has its own terms. The collection notes list them as follows:

| Source | Access / license |
|---|---|
| MODIS MOD13A3 (NASA / USGS LP DAAC) | open, free |
| ERA5-Land (ECMWF / Copernicus) | Copernicus licence (free, attribution required) |
| NASA POWER | open, no API key |
| SoilGrids 2.0 (ISRIC) | CC BY 4.0 |
| ESA WorldCover v200 | CC BY 4.0 |
| FAO GAUL 2015 | see the Earth Engine catalog entry. It was used only to select the study area and is not part of the CSV. |

When the CSV is published, these sources should be credited, as the README does.

GitHub warns when a single file is larger than 50 MB and rejects files larger than 100 MB. The 54.2 MB CSV can be pushed through the normal git command line but will trigger that warning. GitHub's web uploader is limited to 25 MB per file, so this file cannot be added through the browser. Alternatives are a compressed copy (zip or gzip) or Git LFS.
