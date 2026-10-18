"""
Reference values for packages/shared/src/stats.test.ts, from the libraries that define them:
scipy (normal quantile, Student t, the one-sample t-test), statsmodels (Wilson interval,
Benjamini-Yekutieli) and ppi_py (PPI++ for a mean, and the classical interval).

    python -m venv .venv-stats && .venv-stats/Scripts/pip install ppi-python==0.2.3 scipy
    .venv-stats/Scripts/python packages/shared/scripts/stats_reference.py

writes packages/shared/src/stats.reference.json. The inputs are generated here from a fixed
seed and written into the file too, so the tests need no Python.

The alternative annotator test has no library: its reference here is this script's own
reading of the procedure (Calderon, Reichart & Dror, ACL 2025), built from scipy's t-test and
statsmodels' Benjamini-Yekutieli, so it checks the TypeScript against an independent
implementation in another language rather than against the authors' code.
"""

import json
import pathlib
import sys

import numpy as np
import ppi_py
import scipy
import statsmodels
from ppi_py import classical_mean_ci, ppi_mean_ci, ppi_mean_pointestimate
from scipy import stats
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import proportion_confint

OUT = pathlib.Path(__file__).resolve().parents[1] / "src" / "stats.reference.json"
rng = np.random.default_rng(2026)


def ppi_lambda(Y, Yhat, Yhat_unlabeled):
    """The power-tuning weight ppi_mean_ci uses with lam=None (ppi_py 0.2.3, one dimension)."""
    n, N = len(Y), len(Yhat_unlabeled)
    theta = ppi_mean_pointestimate(Y, Yhat, Yhat_unlabeled, lam=1)
    grads = Y - theta
    grads_hat = Yhat - theta
    grads_hat_unlabeled = Yhat_unlabeled - theta
    cov = (2 / n) * np.sum((grads - grads.mean()) * (grads_hat - grads_hat.mean()))
    var = np.var(np.concatenate([grads_hat, grads_hat_unlabeled]), ddof=1)
    return float(np.clip(cov / (2 * (1 + n / N) * var), 0, 1))


def alt_test(model, humans, epsilon, q=0.05, min_humans=2, min_instances=30):
    """The alternative annotator test, accuracy scoring, read from the paper."""
    by_instance = {}
    for h, answers in humans.items():
        for i in answers:
            by_instance.setdefault(i, []).append(h)
    kept = {i for i, hs in by_instance.items() if len(hs) >= min_humans and i in model}
    rows, skipped = [], []
    for h, answers in humans.items():
        instances = [i for i in answers if i in kept]
        if len(instances) < min_instances:
            skipped.append({"annotator": h, "instances": len(instances)})
            continue
        w_model, w_human = [], []
        for i in instances:
            others = [humans[o][i] for o in by_instance[i] if o != h]
            s_human = np.mean([answers[i] == o for o in others])
            s_model = np.mean([model[i] == o for o in others])
            w_model.append(1 if s_model >= s_human else 0)
            w_human.append(1 if s_human >= s_model else 0)
        d = np.array(w_human) - np.array(w_model)
        p = stats.ttest_1samp(d, epsilon, alternative="less").pvalue
        rows.append(
            {
                "annotator": h,
                "instances": len(instances),
                "modelAdvantage": float(np.mean(w_model)),
                "annotatorAdvantage": float(np.mean(w_human)),
                "pValue": None if np.isnan(p) else float(p),
            }
        )
    pvals = [r["pValue"] if r["pValue"] is not None else 1.0 for r in rows]
    rejected = multipletests(pvals, alpha=q, method="fdr_by")[0] if rows else []
    for r, rej in zip(rows, rejected):
        r["modelWins"] = bool(rej)
    winning = float(np.mean(rejected)) if rows else None
    return {
        "annotators": rows,
        "skipped": skipped,
        "winningRate": winning,
        "advantageProbability": float(np.mean([r["modelAdvantage"] for r in rows])) if rows else None,
        "passed": winning is not None and winning >= 0.5,
    }


def labelled_sample(n, N, accuracy, classes=("a", "b", "c")):
    """People's labels and a model's, the model right with probability `accuracy`."""
    truth = rng.choice(len(classes), size=n + N, p=[0.5, 0.3, 0.2])
    right = rng.random(n + N) < accuracy
    noise = (truth + rng.integers(1, len(classes), size=n + N)) % len(classes)
    pred = np.where(right, truth, noise)
    return truth[:n], pred[:n], pred[n:]


out = {
    "versions": {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "statsmodels": statsmodels.__version__,
        "ppi_py": getattr(ppi_py, "__version__", "0.2.3"),
    }
}

out["normalQuantile"] = [[p, float(stats.norm.ppf(p))] for p in [1e-12, 1e-6, 0.001, 0.025, 0.05, 0.3, 0.5, 0.7, 0.95, 0.975, 0.999999]]
out["studentTCdf"] = [
    [t, df, float(stats.t.cdf(t, df))]
    for t in [-8.0, -3.5, -2.0, -0.4, 0.0, 0.9, 2.5, 6.0]
    for df in [1, 2, 5, 29, 59, 300]
]
out["wilson"] = [
    [k, n, *[float(x) for x in proportion_confint(k, n, alpha=0.05, method="wilson")]]
    for k, n in [(0, 10), (1, 10), (8, 10), (10, 10), (15, 40), (37, 40), (500, 1000), (3, 1000)]
]

samples = [rng.choice([-1, 0, 0, 1], size=size) for size in (5, 30, 60)]
samples += [np.zeros(10), np.ones(10), np.full(10, -1.0)]
out["tTestLess"] = []
for xs in samples:
    for mu in (0.1, 0.2):
        p = stats.ttest_1samp(xs, mu, alternative="less").pvalue
        out["tTestLess"].append({"xs": xs.tolist(), "mu": mu, "p": None if np.isnan(p) else float(p)})

out["benjaminiYekutieli"] = []
for m in (1, 4, 10, 25):
    pvals = np.concatenate([rng.uniform(0, 0.01, size=m // 2), rng.uniform(0, 1, size=m - m // 2)])
    rng.shuffle(pvals)
    for q in (0.05, 0.1):
        rejected = multipletests(pvals, alpha=q, method="fdr_by")[0]
        out["benjaminiYekutieli"].append(
            {"p": pvals.tolist(), "q": q, "rejected": [int(i) for i in np.flatnonzero(rejected)]}
        )

out["altTest"] = []
labels = ["x", "y", "z"]
for accuracy, n_items, n_people, epsilon in [(0.9, 60, 3, 0.15), (0.7, 60, 4, 0.1), (0.95, 80, 5, 0.2), (0.6, 40, 3, 0.15)]:
    truth = rng.integers(0, 3, size=n_items)
    humans = {}
    for k in range(n_people):
        answered = rng.random(n_items) < 0.9  # not everyone answers everything
        human_right = rng.random(n_items) < 0.85
        noise = (truth + rng.integers(1, 3, size=n_items)) % 3
        lab = np.where(human_right, truth, noise)
        humans[f"h{k}"] = {f"i{i}": labels[lab[i]] for i in range(n_items) if answered[i]}
    model_right = rng.random(n_items) < accuracy
    noise = (truth + rng.integers(1, 3, size=n_items)) % 3
    mlab = np.where(model_right, truth, noise)
    model = {f"i{i}": labels[mlab[i]] for i in range(n_items) if rng.random() < 0.95}
    out["altTest"].append(
        {"model": model, "humans": humans, "epsilon": epsilon, "result": alt_test(model, humans, epsilon)}
    )

out["ppiMean"] = []
for n, N, accuracy in [(40, 140, 0.4), (60, 2000, 0.85), (200, 5000, 0.95), (30, 300, 0.33)]:
    truth, pred, pred_unl = labelled_sample(n, N, accuracy)
    for cls in (0, 1):
        Y = (truth == cls).astype(float)
        Yhat = (pred == cls).astype(float)
        Yunl = (pred_unl == cls).astype(float)
        low, high = ppi_mean_ci(Y, Yhat, Yunl, alpha=0.05)
        c_low, c_high = classical_mean_ci(Y, alpha=0.05)
        out["ppiMean"].append(
            {
                "labels": Y.tolist(),
                "predicted": Yhat.tolist(),
                "unlabeledPredicted": Yunl.tolist(),
                "ppi": {
                    "estimate": float(np.squeeze(ppi_mean_pointestimate(Y, Yhat, Yunl))),
                    "low": float(np.squeeze(low)),
                    "high": float(np.squeeze(high)),
                    "lambda": ppi_lambda(Y, Yhat, Yunl),
                },
                "classical": {
                    "estimate": float(Y.mean()),
                    "low": float(np.squeeze(c_low)),
                    "high": float(np.squeeze(c_high)),
                },
            }
        )

OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
print(f"wrote {OUT}")
