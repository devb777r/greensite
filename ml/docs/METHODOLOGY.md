# Methodology

This document describes the pipeline in B.GreenSite_MVP_Model_and_Map.ipynb and the website export in B.GreenSite_MVP_Website.ipynb. All numbers come from the model notebook output, and a full re-run of both notebooks on the raw CSV reproduced them.

The pipeline has three parts that we kept separate on purpose:

1. K-Means clustering: unsupervised and exploratory. It groups cells by vegetation history.
2. Rule-based screening: transparent rules for need (vegetation signals) and preliminary soil potential.
3. Ranking: need first, then preliminary soil potential, then data confidence. K-Means is not used here.

All adjustable values are collected in one settings cell at the top of the notebook. They are MVP assumptions, not ecological standards.

| Setting | Value | Meaning |
|---|---|---|
| RANDOM_SEED | 42 | fixed seed for K-Means and the silhouette sample |
| MIN_VALID_MONTHS | 8 | reliable months (out of 12) needed to trust a 12-month mean |
| N_CLUSTERS | 3 | number of K-Means clusters (not tuned) |
| SILHOUETTE_SAMPLE_SIZE | 3000 | cells sampled for the silhouette score |
| LOW_NDVI_PERCENTILE | 25 | lowest 25% of recent NDVI counts as low vegetation |
| DECLINE_THRESHOLD | -0.03 | drop in 12-month mean NDVI that counts as declining |
| SEASONAL_DROP_THRESHOLD | -0.03 | drop below the usual same-month level |
| MIN_USABLE_INDICATORS | 2 | fewer usable indicators means insufficient evidence |
| SAND_UPPER_QUANTILE | 0.75 | sand share above this city-wide quantile counts as sandy |
| TOP_N_CANDIDATES | 100 | number of exported top candidates |

## 1. Loading and validation

The raw CSV is loaded once as `df_raw` and never modified. All work happens on a copy, and a hash of the raw table is stored so the final checks can prove that it did not change.

The notebook then checks that all 20 required columns exist, that there are no duplicate (cell, month) rows, that every cell has the same 41 consecutive months, and that every date is the first of a month. All of these passed. Rows are sorted by cell and date, and month gaps are measured inside each cell only, so values from one cell can never leak into another.

## 2. Preprocessing

New columns are added and the raw ones are kept:

- `ndvi = ndvi_raw × 0.0001`. MODIS stores NDVI as an integer scaled by 10,000. A guard stops the notebook if the values already look like NDVI, so the scaling cannot be applied twice.
- `temperature_c = temperature_2m_K − 273.15`
- `precipitation_mm = total_precipitation_m × 1000`
- `month` (1 to 12) for seasonal comparisons

NDVI quality uses the MODIS quality flag `ndvi_summary_qa`. Only flags 0 (good) and 1 (marginal) are treated as reliable. Other months stay in the table, but their NDVI is set to empty in `ndvi_valid`, so no value is invented and no row is deleted. In the data, 99.5% of observations were reliable and 690 cells had at least one unreliable month.

## 3. Feature engineering

Baghdad's vegetation is strongly seasonal, so we never compare one month with a different month. Instead we use full 12-month windows:

- Recent window: June 2025 to May 2026. Previous window: June 2024 to May 2025.
- `recent_mean_ndvi`: mean reliable NDVI in the recent window.
- `recent_ndvi_change`: recent mean minus previous mean.
- `seasonal_anomaly`: for each recent month, NDVI minus the same cell's mean NDVI in the same calendar month of earlier years (older than the recent window, at least 2 earlier observations). The anomalies are then averaged over the recent months.

A mean is only kept if at least 8 of its 12 months are reliable. No cell fell below that limit. The seasonal anomaly was available for 6,008 cells, with an average of 2.41 earlier observations behind each monthly baseline, which is a short baseline.

Static information (soil, land cover, coordinates) is added once per cell, together with the latest reliable NDVI and its date. Cells that share exactly the same ERA5 temperature value belong to the same coarse climate pixel. There are 74 such pixels, and this grouping is used only for the geographic check in section 8.

## 4. K-Means clustering (exploratory)

- Inputs: `recent_mean_ndvi`, `recent_ndvi_change`, `seasonal_anomaly`. Latitude and longitude are not used, so clusters describe vegetation behaviour, not location.
- Scaling: StandardScaler (mean 0, standard deviation 1), so no indicator dominates because of its units.
- Model: KMeans with k = 3, n_init = 10, random_state = 42. k was not tuned.
- Cells missing any input are not clustered. 6,008 cells were clustered and 3 were not.

Clusters are named from their statistics, not their ID numbers, by ranking their mean recent NDVI:

| Cluster | Cells | Mean recent NDVI | Mean change | Mean seasonal anomaly | Share built-up |
|---|---|---|---|---|---|
| Lowest recent NDVI | 2,559 | 0.152 | -0.000 | -0.006 | 26.5% |
| Middle recent NDVI | 685 | 0.219 | -0.056 | -0.052 | 0.7% |
| Highest recent NDVI | 2,764 | 0.343 | +0.016 | +0.005 | 3.8% |

The middle cluster is the one with a clear decline. We do not call any cluster degraded.

## 5. Rule-based need screening

Three signals are computed per cell:

| Signal | Rule | Cells flagged |
|---|---|---|
| `flag_low_ndvi` | recent NDVI at or below the city's 25th percentile (0.146) | 1,503 |
| `flag_declining` | `recent_ndvi_change` ≤ -0.03 | 559 |
| `flag_below_seasonal` | `seasonal_anomaly` ≤ -0.03 | 696 |

The two change thresholds are close to one standard deviation of the city-wide values (0.029 and 0.024).

The signals are combined into an intervention category:

| Condition | Category | Cells |
|---|---|---|
| fewer than 2 usable indicators | Insufficient evidence | 0 |
| 2 or more signals, at least one of them a change over time | Higher screening priority | 514 |
| 1 or more signals | Moderate screening priority | 1,648 |
| no signals | Lower screening priority | 3,849 |

Low NDVI alone can reach Moderate at most. A cell needs evidence of change over time to reach the top category, so naturally bare land is not promoted only because it is bare.

## 6. Preliminary soil potential

This is a simple, relative soil rating, not a planting-success model. It uses two SoilGrids values (0 to 5 cm), each compared with the rest of Baghdad:

- Organic carbon at or above the city median (8.5 g/kg) counts as one favourable signal.
- Sand at or below the city's 75th percentile (166 g/kg) counts as one favourable signal.

| Condition | Category | Cells |
|---|---|---|
| water cell, or any soil value missing | Needs further assessment | 926 |
| 2 favourable signals | More promising | 1,553 |
| 1 favourable signal | Mixed | 3,327 |
| 0 favourable signals | Less promising | 205 |

Missing soil data is never treated as poor soil. Soil pH was not used because it only ranges from 7.7 to 8.0 across the cells. Clay was not used because we had no justified limit. Climate variables were not used because their resolution is too coarse to separate neighbouring cells.

## 7. Ranking

Every cell is placed in a candidate group:

| Candidate group | Meaning |
|---|---|
| Low-vegetation open area | low recent NDVI, not built-up or water |
| Vegetated area with decline | not in the low-NDVI group, but declining or below its seasonal level |
| Built-up cell (land use must be inspected) | the cell centre is built-up |
| Water / mixed cell (inspect) | the cell centre is water |
| No clear signal | no signal |

`final_priority` comes from the need level only: Higher becomes High, Moderate becomes Medium and Lower becomes Low. Built-up and water cells are capped at Medium, because a 1 km cell is too coarse to show where open land is. The final counts are High 504, Medium 1,658 and Low 3,849.

Cells are then sorted by: need level (descending), number of signals (descending), preliminary soil potential (more promising first), data confidence (more reliable months first), and NDVI change (larger decline first). The position in this order is the rank, from 1 to 6,011. Data confidence is High with 11 or 12 reliable months in the recent window, Medium with 8 to 10, and Low below that.

Each cell also gets a readable `short_reason` that quotes its actual values and a `data_uncertainty` note that lists what is missing or limited for that cell.

## 8. Evaluation

There is no ground truth, so supervised metrics such as accuracy, precision, recall, F1 or ROC-AUC do not exist for this project, and we do not report them. The notebook runs these checks instead:

| Check | Result |
|---|---|
| Data integrity (9 checks: raw data unchanged, NDVI scaled once, no mixing between cells, unreliable NDVI never used, no coordinates in K-Means, no planting-success column, no cell dropped, valid coordinates) | all passed |
| Cluster separation (silhouette score, 3,000-cell sample) | 0.411, weak to moderate structure |
| Agreement between K-Means and the rules | in the declining cluster, 75.8% of cells are flagged as declining and 88.8% as below their seasonal level; in the other clusters these shares are below 4% |
| Geographic concentration of the top 100 | the largest climate pixel holds 34% of the top 100 but only 2% of all cells (×16.8) |
| Real-world outcome validation | not done, because no planting records exist |

The agreement check shows that two independent methods tell a consistent story. It does not show that either of them is correct. The concentration check suggests a regional pattern, such as crop cycles, irrigation or land-use change, that should be checked on imagery before it is trusted.

## 9. Spaced shortlist and Bokeh map (Steps 10A and 10B)

Step 10A prepares the map data without changing any rank or priority:

- Cells whose land-cover code is tree, shrub, grass, cropland or bare (10, 20, 30, 40, 60) are eligible for review. Built-up (50) and water (80) are excluded. This leaves 5,002 eligible and 1,009 excluded cells.
- The distance of each cell to the centre (the median of all cells, 33.2708 N, 44.3720 E) is computed on a local flat projection. The farthest cell is 57.5 km away.
- The Top 100 are the 100 best-ranked eligible cells.
- The spaced Top-20 shortlist walks down the eligible cells in rank order and keeps a cell only if it is at least 5 km from every cell already kept, until 20 are kept. This is done for minimum distances of 0, 20, 30 and 40 km from the centre.

Step 10B draws an interactive Bokeh map with street and satellite basemaps, three colour modes (priority, K-Means cluster, preliminary soil potential), legend toggles, Top-100 and Top-20 overlays, a distance dropdown and a cell inspector panel. It is saved as a standalone HTML file.

## 10. Website export

The website notebook runs the model notebook first, then exports `map_df` to `data/cells.json`. Each field is stored as one list of 6,011 values, and text labels are replaced by small codes that the website maps back to Arabic labels. The export only re-encodes existing values; nothing is recomputed. The website's priority colours follow Step 10B: built-up and water cells are shown as excluded, and the remaining cells keep their High, Medium or Low priority (504, 1,125 and 3,373 cells).

The website recomputes the spaced Top 20 in the browser, because the user can choose any minimum distance from 0 to 50 km. The website notebook checks that this browser logic, run on `cells.json`, gives exactly the same shortlist as Step 10A for 0, 20, 30 and 40 km.
