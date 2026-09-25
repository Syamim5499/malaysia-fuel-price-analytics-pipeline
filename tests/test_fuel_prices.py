from datetime import date, timedelta

import pytest

from pipeline.fuel_prices import LIMIT, validate_snapshot


def snapshot():
    first = date.today() - timedelta(days=21 * 7)
    return [
        {"series_type": "level", "date": (first + timedelta(days=i * 7)).isoformat(),
         "ron95": "2.05", "ron97": "3.20", "diesel": "2.15",
         "diesel_eastmsia": None, "ron95_budi95": None, "ron95_skps": None}
        for i in range(22)
    ]


def test_valid_snapshot_sorts_and_preserves_missing_prices():
    rows = validate_snapshot(list(reversed(snapshot())))
    assert len(rows) == 22
    assert rows[0][0] < rows[-1][0]
    assert rows[-1][4] is None


@pytest.mark.parametrize("mutation", [
    lambda rows: rows.append(rows[0].copy()),
    lambda rows: rows[0].update(ron95="NaN"),
    lambda rows: rows[0].update(series_type="change_weekly"),
    lambda rows: rows[0].update(date="bad-date"),
])
def test_rejects_invalid_snapshots(mutation):
    rows = snapshot()
    mutation(rows)
    with pytest.raises(ValueError):
        validate_snapshot(rows)


def test_rejects_truncated_snapshot():
    with pytest.raises(ValueError):
        validate_snapshot(snapshot() * (LIMIT // 22 + 1))
