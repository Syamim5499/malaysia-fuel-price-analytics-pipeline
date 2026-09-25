"""PostgreSQL backed BI dashboard for Malaysia fuel price study cases."""

import os

import pandas as pd
import plotly.express as px
import psycopg2
import streamlit as st

st.set_page_config(page_title="Malaysia Fuel Price Observatory", layout="wide")
st.title("Malaysia Fuel Price Observatory")
st.caption("Official weekly retail price levels · RM per litre · data.gov.my")


@st.cache_data(ttl=300)
def load_data():
    with psycopg2.connect(os.environ["WAREHOUSE_DSN"]) as conn:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT effective_date, fuel_type, price_rm_litre, previous_price, weekly_change
                FROM mart.fuel_price_long ORDER BY effective_date, fuel_type
            """)
            weekly = pd.DataFrame(cursor.fetchall(), columns=[
                "date", "fuel_type", "price", "previous_price", "weekly_change"
            ])
            cursor.execute("""
                SELECT month, fuel_type, avg_price_rm_litre, observations
                FROM mart.fuel_monthly ORDER BY month, fuel_type
            """)
            monthly = pd.DataFrame(cursor.fetchall(), columns=[
                "month", "fuel_type", "average", "observations"
            ])
            cursor.execute("""
                SELECT fetched_at, source_rows, first_date, last_date
                FROM mart.pipeline_runs ORDER BY fetched_at DESC LIMIT 1
            """)
            run = cursor.fetchone()
    for frame, date_col, numeric_cols in (
        (weekly, "date", ("price", "previous_price", "weekly_change")),
        (monthly, "month", ("average",)),
    ):
        frame[date_col] = pd.to_datetime(frame[date_col])
        for col in numeric_cols:
            frame[col] = pd.to_numeric(frame[col])
    return weekly, monthly, run


try:
    weekly, monthly, run = load_data()
except (psycopg2.Error, KeyError) as exc:
    st.info("Warehouse is waiting for its first successful Airflow DAG run. Trigger malaysia_fuel_price_analytics in Airflow, then refresh this page.")
    st.stop()

if weekly.empty:
    st.info("No price records yet. Trigger the Airflow DAG and refresh.")
    st.stop()

fuel_types = sorted(weekly.fuel_type.unique())
selected = st.sidebar.multiselect("Fuel categories", fuel_types, default=[
    name for name in ("RON95", "RON97", "Diesel Peninsular", "Diesel East Malaysia")
    if name in fuel_types
])
date_range = st.sidebar.date_input(
    "Effective date range", value=(weekly.date.min().date(), weekly.date.max().date()),
    min_value=weekly.date.min().date(), max_value=weekly.date.max().date()
)
if not selected or not isinstance(date_range, tuple) or len(date_range) != 2:
    st.warning("Select at least one fuel category and a valid date range.")
    st.stop()
start, end = date_range
if start > end:
    st.warning("The start date must be no later than the end date.")
    st.stop()

filtered = weekly[
    weekly.fuel_type.isin(selected) & weekly.date.dt.date.between(start, end)
].copy()
if filtered.empty:
    st.warning("No records in this selection.")
    st.stop()

st.caption(f"Latest pipeline load: {run[0]:%Y-%m-%d %H:%M UTC} · {run[1]} source weeks · source through {run[3]}")

st.subheader("Study 1 · Current price and weekly movement")
latest = filtered.sort_values("date").groupby("fuel_type").tail(1)
columns = st.columns(min(len(latest), 4))
for index, row in enumerate(latest.itertuples()):
    change = "n/a" if pd.isna(row.weekly_change) else f"RM {row.weekly_change:+.3f}"
    columns[index % len(columns)].metric(row.fuel_type, f"RM {row.price:.3f}", change)
st.caption("Each card shows the latest available week within the selected date range. Weekly change compares consecutive available observations of the same category.")

st.subheader("Study 2 · Long run price trends")
st.plotly_chart(px.line(filtered, x="date", y="price", color="fuel_type", labels={
    "date": "Effective date", "price": "RM per litre", "fuel_type": "Fuel"
}), use_container_width=True)

st.subheader("Study 3 · Monthly averages and volatility")
monthly_selected = monthly[
    monthly.fuel_type.isin(selected) & monthly.month.dt.date.between(start, end)
]
left, right = st.columns(2)
with left:
    st.plotly_chart(px.line(monthly_selected, x="month", y="average", color="fuel_type",
        labels={"month": "Month", "average": "Average RM per litre", "fuel_type": "Fuel"}),
        use_container_width=True)
with right:
    volatility = filtered.groupby("fuel_type", as_index=False).agg(
        weekly_change_std=("weekly_change", "std"), weeks=("date", "size")
    ).fillna({"weekly_change_std": 0})
    st.plotly_chart(px.bar(volatility, x="fuel_type", y="weekly_change_std",
        hover_data=["weeks"], labels={"fuel_type": "Fuel", "weekly_change_std": "Std. dev. of weekly RM change"}),
        use_container_width=True)
st.caption("Monthly averages use observed weekly price levels, so months with more effective dates have more observations. Volatility is the sample standard deviation of consecutive weekly changes within the selected period.")

st.subheader("Study 4 · Diesel regional price gap")
diesel = weekly[weekly.fuel_type.isin(["Diesel Peninsular", "Diesel East Malaysia"])]
diesel = diesel.pivot(index="date", columns="fuel_type", values="price").dropna()
if not diesel.empty:
    diesel["gap"] = diesel["Diesel Peninsular"] - diesel["Diesel East Malaysia"]
    diesel = diesel.loc[(diesel.index.date >= start) & (diesel.index.date <= end)]
    st.plotly_chart(px.line(diesel.reset_index(), x="date", y="gap", labels={
        "date": "Effective date", "gap": "Peninsular minus East Malaysia (RM/litre)"
    }), use_container_width=True)
else:
    st.info("Regional diesel comparison is unavailable for this selection.")

with st.expander("Explore the records"):
    st.dataframe(filtered.sort_values("date", ascending=False), use_container_width=True,
        hide_index=True)

st.caption("Interpretation: fuel prices are regulated and policy dependent. Diesel subsidy changes in June 2024 and the RON95 BUDI95 series from September 2025 create structural breaks; do not treat differences as causal effects. Source: data.gov.my fuelprice (CC BY 4.0).")
