# Real-hand analyses

These scripts fit the settings that the case study and the live Bankroll Risk
tool take from real hands:

- **Questions 1 and 2:** how heavy-tailed one player's 100-hand results are, and
  whether neighbouring blocks carry over. These give case study §3's "Fitted to
  real hands" rows, through the block in `configs/case_study/assumptions.yaml`.
- **Question 3:** how far apart players' true win rates are. This gives the two
  priors in `configs/population_priors.json`, which the live tool and case
  study §2 read.

## Data

[PHH dataset](https://zenodo.org/doi/10.5281/zenodo.10796885): Kim (2024),
*Recording and Describing Poker Hands*, arXiv:2312.11753, CC BY 4.0.

- **Subset:** the HandHQ logs for PartyPoker and Ongame no-limit hold'em, $2/$4,
  1–23 July 2009.
- **Size:** 1,736 files, 1.3 GB, at dataset commit `e47fbd5`.

The hands are **not in this repository**, and neither are the tables built from
them. Players appear only as the dataset's obfuscated IDs. Nothing here tries to
identify anyone, and only aggregate results are saved. `.gitignore` excludes
`*.phhs`, `*.parquet` and `/data/`.

## Running it

From the repository root, with Python 3.12:

```bash
pip install -r research/real-hands/requirements.txt
python -I research/real-hands/fetch_data.py ../poker-risk-lab-data/raw/phh-dataset
python -I research/real-hands/build_tables.py ../poker-risk-lab-data/raw/phh-dataset ../poker-risk-lab-data/derived
python -I -B research/real-hands/analyze_q1q2.py ../poker-risk-lab-data/derived
python -I -B research/real-hands/ruin_calibrated.py
python -I -B research/real-hands/make_figures_q1q2.py
python -I -B research/real-hands/analyze_q3.py ../poker-risk-lab-data/derived
python -I -B research/real-hands/make_figures_q3.py
```

| Script | Reads | Writes |
|---|---|---|
| `fetch_data.py` | GitHub, at the pinned commit | A sparse clone outside the repository. `--check` checks an existing clone. |
| `build_tables.py` | The clone | `hands.parquet`, `player_hands.parquet` and `build_report.json`, outside the repository |
| `analyze_q1q2.py` | The derived tables | `reports/real-hands/q1q2/`: `results.json` and four CSV tables |
| `ruin_calibrated.py` | — | `reports/real-hands/q1q2/ruin_calibrated.json`: §3's scenario with the fitted settings |
| `make_figures_q1q2.py` | `q1q2/` | Figures 1–4 |
| `analyze_q3.py` | The derived tables | `reports/real-hands/q3/`: `results.json`, `population.csv` and `chapter2.csv` |
| `make_figures_q3.py` | `q3/` | Figures 5 and 6 |

`build_tables.py` uses every CPU core. The analyses and figures took about 2½ minutes in all (`analyze_q1q2.py` 99 s, `analyze_q3.py` 33 s)
on an Apple-silicon laptop.

## How the numbers reach the pages

- **Copied by hand:** the summary numbers go into
  `configs/case_study/assumptions.yaml` (`fitted.source`) and
  `configs/population_priors.json`.
- **Checked by tests:** `tests/test_real_hands.py` confirms that those copies
  match the saved results. It also confirms that the saved results came from the
  scripts in this folder, by their sha256.
- **Rerunning:** if you rerun the analyses, update both configs. Then rerun the
  case study (`python -m src.experiments.case_study --case all`), regenerate
  `checks/bankroll-posterior-python/`, and rebuild the pages (`npm run build`).

## Method notes

- **Accounting** (`build_tables.py`): each hand is replayed to get every
  player's contribution, and the uncalled bet is returned.
  - Net result = winnings − amount put in; rake = pot − total winnings.
  - Site differences: PartyPoker's `winnings` include the returned bet, Ongame's
    do not. Rake caps are $3.50 (PartyPoker) and $3.00 (Ongame).
  - Hands that fail an accounting check are left out of the analyses, about 2%.
- **Questions 1 and 2:**
  - **Sample:** players with at least 5,000 usable hands. Their hands are cut in
    time order into 100-hand blocks.
  - **Standardization:** each player's blocks are standardized with that
    player's own mean and standard deviation.
  - **Breaks:** a gap of more than 30 minutes counts as a break.
  - **Comparison with the models:** the case study's own models
    (`src/models.py`) are simulated with the same block counts and put through
    the same statistics.
- **Question 3:**
  - **Model:** a hierarchical Normal model, fitted by maximum likelihood within
    four groups of players by hands played.
  - **All-players prior:** the groups mixed by number of players.
  - **Checks:**
    - shape: a nonparametric prior;
    - spread without standard errors: odd against even hands;
    - selection: earlier against later half of each player's hands, and the
      month split in two;
    - prediction: each regular's later half predicted from the earlier half.
- **Intervals:** 95%, resampling players with 2,000 bootstrap samples.

## Limits

- **Narrow sample:** one stake, two sites and 23 days in 2009, before solvers.
- **Partial coverage:** the logs miss some tables, so each player's sequence has
  gaps.
- **Selection:** players who stop after losing make the non-regulars'
  estimates approximate. Only the 10,000+ hands group (the regulars) passes the
  selection check.
- **Zero-sum:** players at the same table are not independent, which resampling
  players ignores.

`phh_probe*.py`, the feasibility probes used before the download, are not
included.
