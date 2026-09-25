from datetime import datetime, timedelta, timezone

from airflow import DAG
from airflow.operators.python import PythonOperator
from pipeline.fuel_prices import run_pipeline


with DAG(
    dag_id="malaysia_fuel_price_analytics",
    description="Official Malaysian weekly fuel prices into PostgreSQL analytics marts",
    schedule="0 12 * * 3",
    start_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
    catchup=False,
    max_active_runs=1,
    default_args={"owner": "portfolio", "retries": 2, "retry_delay": timedelta(minutes=5)},
    tags=["malaysia", "public-data", "analytics"],
) as dag:
    PythonOperator(task_id="extract_validate_and_publish", python_callable=run_pipeline)
