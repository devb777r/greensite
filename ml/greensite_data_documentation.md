# GreenSite AI – Raw Baghdad Dataset (v2): Documentation

**Status:** the script `greensite_raw_dataset_v2.py` produces the CSV when you run it in Google Colab. No data was downloaded while writing this document, so there are no row counts or missing-value numbers here. The script prints them and writes `validation_report.txt`.

## 1. Design choices

| Choice | Value | Why |
|---|---|---|
| Area | Baghdad Governorate (FAO GAUL 2015, level 1) | Official administrative boundary |
| Grid | Native MODIS MOD13A3 1 km pixel centres (~5,000 cells, to be confirmed by the script's printed cell count) | The NDVI target is a genuine monthly 1 km product, so it needs no resampling or aggregation |
| Period | Jan 2023 → May 2026 (41 months, as actually run) | Recent data. Months with no source image yet are skipped, never filled |
| Actual size | 6,011 cells × 41 months = 246,451 rows, 20 columns | Shorten `START`/`END` for a smaller file |

## 2. Data dictionary

| Column | Meaning | Unit / raw encoding | Source |
|---|---|---|---|
| cell_id | Index of the grid cell (join key only) | integer | script |
| latitude, longitude | Cell-centre coordinates | degrees (WGS84) | MODIS pixel centre |
| date | First day of the month | YYYY-MM-DD | – |
| ndvi_raw | NDVI, monthly composite | integer, **scale 0.0001** (raw MODIS value; fill value −3000) | MOD13A3 |
| ndvi_summary_qa | MODIS quality flag | 0 good, 1 marginal, 2 snow/ice, 3 cloudy | MOD13A3 |
| temperature_2m_K | Mean 2 m air temperature | kelvin | ERA5-Land |
| dewpoint_2m_K | Mean 2 m dewpoint | kelvin | ERA5-Land |
| humidity_rh2m_pct | Monthly mean relative humidity at 2 m | % (**−999 = POWER missing flag, kept raw**) | NASA POWER (MERRA-2) |
| total_precipitation_m | Monthly total precipitation | metres of water | ERA5-Land |
| soil_moisture_vwc_layer1 | Volumetric soil water, 0–7 cm | m³/m³ | ERA5-Land |
| total_evaporation_m | Monthly total evaporation | metres (ECMWF sign convention: negative = evaporation) | ERA5-Land |
| potential_evaporation_m | Monthly potential evaporation | metres (same sign convention) | ERA5-Land |
| soil_ph_x10 | Soil pH in H2O, 0–5 cm | pH × 10 | SoilGrids |
| soil_organic_carbon_dg_kg | Soil organic carbon, 0–5 cm | dg/kg | SoilGrids |
| sand_g_kg, clay_g_kg | Sand / clay fraction, 0–5 cm | g/kg | SoilGrids |
| land_cover_code | ESA WorldCover class at the cell-centre point | 10 tree, 20 shrub, 30 grass, 40 crop, 50 built-up, 60 bare, 80 water, etc. | WorldCover 2021 |
| power_lat, power_lon | Centre of the NASA POWER grid cell used for humidity | degrees | script (join key, kept for transparency) |

## 3. Source table

| Feature | Dataset | Organization | Official URL | Resolution | Temporal | License / access |
|---|---|---|---|---|---|---|
| NDVI | MOD13A3 v6.1 (`MODIS/061/MOD13A3`) | NASA / USGS LP DAAC | https://lpdaac.usgs.gov/products/mod13a3v061/ | 1 km | Monthly | Open, free |
| Temperature, dewpoint, precipitation, soil moisture, evaporation | ERA5-Land monthly aggregates (`ECMWF/ERA5_LAND/MONTHLY_AGGR`) | ECMWF / Copernicus | https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land-monthly-means | ~9–11 km | Monthly | Copernicus licence (free) |
| Relative humidity | NASA POWER monthly RH2M (MERRA-2) | NASA Langley Research Center | https://power.larc.nasa.gov/ (API: `https://power.larc.nasa.gov/api/temporal/monthly/point`) | 0.5° × 0.625° (~55 × 60 km) | Monthly | Open, no API key |
| Soil pH, SOC, sand, clay | SoilGrids 2.0 (`projects/soilgrids-isric/*_mean`, 0–5 cm band) | ISRIC | https://docs.isric.org/globaldata/soilgrids/access_on_gee.html | 250 m | Static | CC BY 4.0 |
| Land cover | ESA WorldCover v200 (`ESA/WorldCover/v200`) | ESA | https://esa-worldcover.org | 10 m | Static (2021) | CC BY 4.0 |
| Boundary | FAO GAUL 2015 level 1 | FAO | Earth Engine catalog: `FAO/GAUL/2015/level1` | Vector | Static | See catalog entry |

**Retrieval method (all sources):** Earth Engine `reduceRegions` with the `first` reducer at each MODIS cell centre. NASA POWER is retrieved through its REST API once per distinct POWER grid cell that covers Baghdad (a handful of calls), and joined by cell and month.

I checked in this session that POWER offers RH2M monthly with 0.5° × 0.625° meteorology resolution, and that the SoilGrids Earth Engine asset names and CC BY 4.0 licence match the code. I did not verify the other Earth Engine dataset IDs against the live catalog, or that every month up to July 2026 exists. The script reports any missing months.

## 4. Limitations

1. **Humidity is reanalysis, not a station measurement.** NASA POWER RH2M comes from the MERRA-2 model. At ~55 × 60 km it covers Baghdad with only a few cells, so humidity is nearly constant across the city for each month. Dewpoint from ERA5-Land is kept as a second, independent moisture variable.
2. **ERA5-Land is also coarse (~9–11 km).** Many 1 km cells share the same temperature, precipitation, soil moisture and evaporation values, so spatial variation in these columns is much smaller than the row count suggests.
3. **Static layers.** WorldCover is a single year (2021). SoilGrids has no time dimension. Both repeat on every row of a cell.
4. **Point sampling, not area aggregation.** WorldCover (10 m) and SoilGrids (250 m) are sampled at the cell-centre point, so a 1 km cell's land-cover mix is not captured.
5. **Raw encodings are kept.** NDVI ×10,000, kelvin, metres, pH ×10, and −999 / −3000 fill values are not converted. Check `ndvi_summary_qa` before trusting NDVI values.
6. **Recent months may be missing.** ERA5-Land and MODIS publish with a delay of weeks to months. The script lists skipped months. POWER may return −999 for the newest months.
7. **No drought indicator.** Only raw ERA5 evaporation, potential evaporation, precipitation and soil moisture are provided. No drought index is calculated.
8. **Unverified items.** Earth Engine dataset IDs other than SoilGrids, and the GAUL boundary names, were written from memory. The script asserts that exactly one Baghdad feature is found. If it fails, swap in another boundary.
9. **Runtime.** About 40 months × a few chunks of Earth Engine calls can take tens of minutes in Colab.
10. **Target alignment.** The CSV has one row per cell and month with no future column. You build NDVI(t+1) yourself by shifting `ndvi_raw` within each `cell_id`.

## 5. Validation results (actual run, reported by the user)

| Check | Result |
|---|---|
| Rows / columns | 246,451 / 20 |
| Unique locations / dates | 6,011 / 41 (2023-01-01 → 2026-05-01) |
| Latitude range | 32.8375 – 33.7708 |
| Longitude range | 43.8491 – 44.9654 |
| Months skipped | none |
| Missing values | 0% in all columns except soil: pH, sand, clay 12.06% (29,725 rows = 725 cells × 41 months); organic carbon 12.01% (29,602 rows = 722 cells) |
| Observations per source | MOD13A3 246,451; ERA5-Land 246,451; NASA POWER 246,451 (0 flagged −999); SoilGrids 216,726; WorldCover 246,451 |
| NDVI fill values (−3000) | 0 |
| NDVI quality flag | 0 good: 225,991 (91.7%); 1 marginal: 19,222 (7.8%); 3 cloudy: 1,238 (0.5%); 2 snow/ice: none |
| Distinct values per month | ERA5 temperature: 74; NASA POWER humidity: 7 |

**Cells with missing soil (725) by WorldCover class:** built-up 529, bare 81, tree 49, water 45, crop 16, shrub 5. The missing soil data is therefore concentrated in built-up cells, so it is not random.

## 6. Consequences for modelling

- The effective number of independent climate observations is far smaller than 246,451: 74 ERA5 values and 7 humidity values per month are shared by 6,011 cells.
- Neighbouring cells share the same climate inputs and are spatially correlated. A random row-wise train/test split would leak information, so split by time (earlier months for training, later months for testing) or by group of cells.
- Soil missingness is informative (mostly built-up land). Dropping those rows would remove most urban cells and bias the sample.
- The last month of each cell has no t+1 target, which leaves about 240,000 usable rows after you build the target.

## 7. Direct inspection of the delivered CSV (8 Oct 2026)

- Retrieval run and download date: 8 October 2026. The run used `START = 2023-01-01` and an `END` set so the last month is May 2026.
- Structure confirmed from the file itself: 246,451 rows, 20 columns, 6,011 cells with exactly 41 months each, no duplicate (cell, date) pairs, no month gaps. `date` is stored as text (YYYY-MM-DD).
- No −3000 (MODIS) or −999 (NASA POWER) flags are present.
- Ranges look plausible: monthly mean temperature 282.9–313.6 K, humidity 14.0–71.7 %, NDVI raw −586 to 7,536 (−0.06 to 0.75), soil pH ×10 77–80.
- Mean NDVI by calendar month peaks in Jan–Apr (about 0.29–0.32) and is lowest in Jul–Oct (about 0.21).
- Land-cover class by cell: cropland (40) 2,296; bare (60) 1,547; tree (10) 809; built-up (50) 791; shrub (20) 262; water (80) 218; grass (30) 88.
- 529 of the 791 built-up cells (67%) have no SoilGrids values.
- Total precipitation takes a single value across all cells in September 2024.
- Soil moisture has a minimum of −1.0e-20 (numerical noise in the source).
- NASA POWER humidity comes from 7 distinct POWER grid cells.
- Not verified: values were not compared with the original sources, because the inspection environment had no internet access.
