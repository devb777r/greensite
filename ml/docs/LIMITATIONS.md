# Limitations

B.GreenSite is an MVP for preliminary screening. This document lists what the results can and cannot be used for, and why.

## Screening is not planting suitability

The output answers one question: which cells show warning signs in their vegetation history and should be inspected first. It does not say that a cell can be planted, that trees will survive there, or that the land is degraded. A High priority cell is a candidate for further assessment. Before any decision it still needs checks on imagery, on site, of water access, land ownership and current use, and by an expert.

## No outcome labels

We had no records of where planting succeeded or failed. Because of that:

- No supervised model was trained, and nothing in the project predicts planting success or survival.
- Accuracy, precision, recall, F1 and ROC-AUC do not exist for this project, and none are reported.
- The rule thresholds could not be calibrated against real outcomes.

## K-Means is exploratory

K-Means groups cells with similar vegetation history. The silhouette score of 0.411 means the groups are only partly separated and overlap. The number of clusters (k = 3) was chosen and not tuned. The clusters describe patterns. They are not labels of degradation and they are not used to compute the priority.

## What NDVI can and cannot show

- Low NDVI does not prove degradation. Desert, bare soil, built-up land and fallow farmland are all naturally low.
- A drop in NDVI between years can come from weather, crop rotation, harvest timing, irrigation changes or construction. The indicators cannot tell these apart. Rainfall in the recent 12 months (about 257 mm) was very different from the previous 12 months (about 120 mm).
- The data covers about 3.4 years. The seasonal baseline uses only 2 to 3 earlier observations per calendar month, which is a short reference.
- NDVI is a 1 km average. One cell can mix fields, roads, buildings and water.

## Soil and land cover

- Soil values come from SoilGrids 2.0 (250 m, top 0 to 5 cm), static and sampled at the cell centre. About 12% of cells (756) have no soil data, mostly built-up land. They are marked as needing assessment, not as poor soil, but it means soil is least known exactly where land use is most uncertain.
- The preliminary soil potential uses only organic carbon and sand, compared with the Baghdad median and 75th percentile. Water availability, salinity, depth and contamination are not included.
- Land cover is a single ESA WorldCover value at the cell centre. A cell marked built-up may still contain open space, and one marked cropland may be private farmland in active use.
- Built-up and water cells are capped at Medium priority in the notebook and excluded from the shortlist and from the website's priority classes, because a 1 km cell cannot show where open ground is.

## Climate

Temperature, precipitation and the other climate variables come from coarse grids. In any month, ERA5-Land temperature takes at most 74 distinct values across the 6,011 cells, and NASA POWER humidity only 7. They are therefore not used to separate cells and are shown only as context.

## Thresholds are assumptions

The 25th-percentile NDVI cut-off, the -0.03 change thresholds, the 8-month reliability rule, the soil limits and the 5 km spacing of the Top 20 are reasonable starting values for an MVP, not ecological standards. Changing them changes the ranking. All of them are collected in one settings cell so their effect can be tested.

## Geographic concentration

The top 100 cells are concentrated: one coarse climate pixel holds 34% of them while covering only 2% of all cells. This most likely reflects a regional pattern such as crop cycles or land-use change, and it should be checked on satellite imagery before the shortlist is trusted. The spaced Top 20 reduces this effect but does not remove its cause.

## Data provenance

The CSV was collected before the notebooks with a Google Earth Engine script and the NASA POWER API. The script itself is not part of this repository; its notes and validation output are. The values were not compared with the original sources after download, and the Earth Engine dataset IDs other than SoilGrids were not checked against the live catalog. Land cover is a single year (WorldCover 2021), so later land-use changes are not reflected.

## Website and notebooks

- The model notebook uses Colab's upload dialog, so it runs as written only in Google Colab.
- The website link printed by the website notebook comes from Colab's port proxy. It works only for the signed-in user while the runtime is active, and it is not a public deployment.
- Building the site needs internet access to the npm registry and GitHub-hosted data. Viewing it needs Esri's tile service for the satellite basemap.
- Only Baghdad has data. The other governorates are shown as coming soon.
