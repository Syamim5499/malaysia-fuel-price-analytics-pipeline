"""Fetch official weekly price levels and publish an atomic PostgreSQL snapshot."""

import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import psycopg2
import requests
from psycopg2.extras import Json, execute_values

API_URL = "https://api.data.gov.my/data-catalogue"
LIMIT = 10000
PRICE_FIELDS = (
    "ron95", "ron97", "diesel", "diesel_eastmsia", "ron95_budi95", "ron95_skps"
)


def fetch_snapshot(session=None):
    client = session or requests
    response = client.get(
        API_URL,
        params={"id": "fuelprice", "filter": "level@series_type", "limit": LIMIT},
        timeout=(10, 60),
        headers={"User-Agent": "malaysia-fuel-price-analytics/1.0"},
    )
    response.raise_for_status()
    return response.json()


def validate_snapshot(payload):
    if not isinstance(payload, list) or not payload or len(payload) >= LIMIT:
        raise ValueError("Expected a nonempty, untruncated JSON array of price levels")

    parsed = []
    seen = set()
    for row in payload:
        if not isinstance(row, dict) or row.get("series_type") != "level":
            raise ValueError("Every record must be a level series object")
        try:
            effective_date = date.fromisoformat(row["date"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Invalid effective date") from exc
        if effective_date in seen:
            raise ValueError(f"Duplicate effective date: {effective_date}")
        seen.add(effective_date)
        values = []
        for field in PRICE_FIELDS:
            value = row.get(field)
            if value is None or value == "":
                values.append(None)
                continue
            try:
                amount = Decimal(str(value))
            except InvalidOperation as exc:
                raise ValueError(f"Invalid {field} on {effective_date}") from exc
            if not amount.is_finite() or amount <= 0 or amount > 100:
                raise ValueError(f"Out-of-range {field} on {effective_date}")
            values.append(amount)
        if not any(value is not None for value in values):
            raise ValueError(f"No prices on {effective_date}")
        parsed.append((effective_date, *values))

    parsed.sort(key=lambda item: item[0])
    if parsed[-1][0] > date.today() or parsed[-1][0] < date(2020, 1, 1):
        raise ValueError("Latest price date is outside the expected range")
    if parsed[-1][0] < date.today() - timedelta(days=35):
        raise ValueError("Latest price date is more than 35 days old")
    if len(parsed) < 20:
        raise ValueError("Historical snapshot is unexpectedly short")
    return parsed


DDL = """
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS mart;
CREATE TABLE IF NOT EXISTS raw.fuel_price_api (
    run_id text NOT NULL,
    effective_date date NOT NULL,
    payload jsonb NOT NULL,
    fetched_at timestamptz NOT NULL,
    PRIMARY KEY (run_id, effective_date)
);
CREATE TABLE IF NOT EXISTS core.fuel_price_weekly (
    effective_date date PRIMARY KEY,
    ron95 numeric(8,3), ron97 numeric(8,3), diesel numeric(8,3),
    diesel_eastmsia numeric(8,3), ron95_budi95 numeric(8,3), ron95_skps numeric(8,3)
);
CREATE TABLE IF NOT EXISTS mart.fuel_price_long (
    effective_date date NOT NULL,
    fuel_type text NOT NULL,
    price_rm_litre numeric(8,3) NOT NULL,
    previous_price numeric(8,3),
    weekly_change numeric(8,3),
    PRIMARY KEY (effective_date, fuel_type)
);
CREATE TABLE IF NOT EXISTS mart.fuel_monthly (
    month date NOT NULL,
    fuel_type text NOT NULL,
    avg_price_rm_litre numeric(8,3) NOT NULL,
    min_price_rm_litre numeric(8,3) NOT NULL,
    max_price_rm_litre numeric(8,3) NOT NULL,
    observations integer NOT NULL,
    PRIMARY KEY (month, fuel_type)
);
CREATE TABLE IF NOT EXISTS mart.pipeline_runs (
    run_id text PRIMARY KEY,
    fetched_at timestamptz NOT NULL,
    source_rows integer NOT NULL,
    first_date date NOT NULL,
    last_date date NOT NULL
);
"""


def publish_snapshot(connection, payload, rows, fetched_at):
    """All writes share one transaction; failed validation or SQL rolls back."""
    indexed = {date.fromisoformat(item["date"]): item for item in payload}
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:24]
    run_id = f"{fetched_at.isoformat()}-{digest}"
    with connection:
        with connection.cursor() as cursor:
            cursor.execute(DDL)
            execute_values(
                cursor,
                "INSERT INTO raw.fuel_price_api VALUES %s",
                [(run_id, row[0], Json(indexed[row[0]]), fetched_at) for row in rows],
            )
            cursor.execute("TRUNCATE core.fuel_price_weekly, mart.fuel_price_long, mart.fuel_monthly")
            execute_values(
                cursor,
                "INSERT INTO core.fuel_price_weekly VALUES %s", rows,
            )
            cursor.execute("""
                INSERT INTO mart.fuel_price_long
                (effective_date, fuel_type, price_rm_litre, previous_price, weekly_change)
                WITH unpivoted AS (
                    SELECT effective_date, fuel_type, price_rm_litre
                    FROM core.fuel_price_weekly c
                    CROSS JOIN LATERAL (VALUES
                        ('RON95', c.ron95), ('RON97', c.ron97), ('Diesel Peninsular', c.diesel),
                        ('Diesel East Malaysia', c.diesel_eastmsia),
                        ('RON95 BUDI95', c.ron95_budi95), ('RON95 SKPS', c.ron95_skps)
                    ) v(fuel_type, price_rm_litre)
                    WHERE price_rm_litre IS NOT NULL
                ), lagged AS (
                    SELECT *, lag(price_rm_litre) OVER (
                        PARTITION BY fuel_type ORDER BY effective_date
                    ) AS previous_price FROM unpivoted
                )
                SELECT effective_date, fuel_type, price_rm_litre, previous_price,
                    price_rm_litre - previous_price FROM lagged
            """)
            cursor.execute("""
                INSERT INTO mart.fuel_monthly
                SELECT date_trunc('month', effective_date)::date, fuel_type,
                    round(avg(price_rm_litre), 3), min(price_rm_litre),
                    max(price_rm_litre), count(*)
                FROM mart.fuel_price_long
                GROUP BY 1, 2
            """)
            cursor.execute("""
                INSERT INTO mart.pipeline_runs VALUES (%s, %s, %s, %s, %s)
            """, (run_id, fetched_at, len(rows), rows[0][0], rows[-1][0]))
    return run_id


def run_pipeline():
    payload = fetch_snapshot()
    rows = validate_snapshot(payload)
    fetched_at = datetime.now(timezone.utc)
    with psycopg2.connect(os.environ["WAREHOUSE_DSN"]) as connection:
        run_id = publish_snapshot(connection, payload, rows, fetched_at)
    print(f"Published {len(rows)} weeks through {rows[-1][0]}; run_id={run_id}")
