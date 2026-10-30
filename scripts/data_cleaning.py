"""Clean the DataCo source file for client-side dashboard use."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "data" / "raw" / "DataCoSupplyChainDataset.csv"
LEGACY_INPUT = PROJECT_ROOT / "data" / "DataCoSupplyChainDataset.csv"
DEFAULT_OUTPUT = PROJECT_ROOT / "data" / "processed" / "cleaned_dataco.csv"

SOURCE_COLUMNS = {
    "Order Id": "order_id",
    "order date (DateOrders)": "order_date",
    "shipping date (DateOrders)": "shipping_date",
    "Days for shipping (real)": "source_shipping_days",
    "Days for shipment (scheduled)": "scheduled_days",
    "Sales": "sales",
    "Order Item Total": "order_total",
    "Order Item Quantity": "quantity",
    "Order Item Product Price": "unit_price",
    "Order Item Discount": "item_discount",
    "Delivery Status": "source_delivery_status",
    "Late_delivery_risk": "late_risk",
    "Category Name": "category",
    "Product Name": "product",
    "Product Card Id": "product_id",
    "Product Status": "product_status",
    "Market": "market",
    "Order Region": "region",
    "Shipping Mode": "shipping_mode",
    "Order Status": "order_status",
    "Type": "order_type",
}

NUMERIC_COLUMNS = [
    "source_shipping_days",
    "scheduled_days",
    "sales",
    "order_total",
    "quantity",
    "unit_price",
    "item_discount",
    "late_risk",
    "product_status",
]


def _format_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce")


def clean_data(raw: pd.DataFrame) -> pd.DataFrame:
    """Return a minimized, de-identified, dashboard-ready item-level dataset."""
    data = raw.rename(columns={key: value for key, value in SOURCE_COLUMNS.items() if key in raw})
    missing_columns = sorted(set(SOURCE_COLUMNS.values()) - set(data.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {', '.join(missing_columns)}")

    data = data[list(SOURCE_COLUMNS.values())].copy()
    data["order_date"] = _format_date(data["order_date"])
    data["shipping_date"] = _format_date(data["shipping_date"])
    for column in NUMERIC_COLUMNS:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data[NUMERIC_COLUMNS] = data[NUMERIC_COLUMNS].replace([np.inf, -np.inf], np.nan)

    initial_rows = len(data)
    data = data.dropna(subset=["order_id", "order_date", "sales", "quantity"]).copy()
    if data.empty:
        raise ValueError("No rows remain after removing missing order IDs, dates, sales, and quantities.")

    for column in [
        "category",
        "product",
        "market",
        "region",
        "shipping_mode",
        "order_status",
        "order_type",
        "source_delivery_status",
    ]:
        data[column] = data[column].astype("string").str.strip().replace("", pd.NA).fillna("Unknown")

    data["product_id"] = data["product_id"].astype("string").fillna("Unknown")
    data["warehouse_proxy"] = data["market"]
    data["late_risk"] = data["late_risk"].fillna(0).clip(0, 1)
    data["product_status"] = data["product_status"].fillna(0).clip(0, 1)
    data.loc[data["scheduled_days"] < 0, "scheduled_days"] = np.nan
    data.loc[data["source_shipping_days"] < 0, "source_shipping_days"] = np.nan

    date_duration = (data["shipping_date"] - data["order_date"]).dt.total_seconds() / 86_400
    valid_date_duration = date_duration.where(date_duration >= 0)
    duration = valid_date_duration.fillna(data["source_shipping_days"])
    duration = duration.fillna(data["scheduled_days"])
    data["shipping_duration_days"] = duration.round(2)

    missing_shipping_date = data["shipping_date"].isna()
    data.loc[missing_shipping_date, "shipping_date"] = (
        data.loc[missing_shipping_date, "order_date"]
        + pd.to_timedelta(data.loc[missing_shipping_date, "shipping_duration_days"], unit="D")
    )
    invalid_shipping_date = data["shipping_date"] < data["order_date"]
    data.loc[invalid_shipping_date, "shipping_date"] = (
        data.loc[invalid_shipping_date, "order_date"]
        + pd.to_timedelta(data.loc[invalid_shipping_date, "shipping_duration_days"], unit="D")
    )

    source_status = data["source_delivery_status"].str.casefold()
    canceled = source_status.str.contains("cancel")
    late_by_source = source_status.str.contains("late")
    advance_by_source = source_status.str.contains("advance")
    on_time_by_source = source_status.str.contains("on time")
    comparable = data["shipping_duration_days"].notna() & data["scheduled_days"].notna()
    late_by_schedule = comparable & data["shipping_duration_days"].gt(data["scheduled_days"])

    data["delivery_status"] = np.select(
        [
            canceled,
            late_by_source,
            advance_by_source,
            on_time_by_source,
            late_by_schedule,
            comparable,
        ],
        [
            "Shipping canceled",
            "Late delivery",
            "Advance shipping",
            "Shipping on time",
            "Late delivery",
            "Shipping on time",
        ],
        default="Unknown",
    )
    data["is_on_time"] = data["delivery_status"].isin(["Advance shipping", "Shipping on time"])
    data["is_late"] = data["delivery_status"].eq("Late delivery")
    data["product_available"] = data["product_status"].eq(0)
    data["month"] = data["order_date"].dt.to_period("M").astype(str)
    data["year"] = data["order_date"].dt.year.astype("Int64")

    cleaned = data[
        [
            "order_id",
            "order_date",
            "shipping_date",
            "month",
            "year",
            "shipping_duration_days",
            "scheduled_days",
            "delivery_status",
            "is_on_time",
            "is_late",
            "late_risk",
            "sales",
            "order_total",
            "quantity",
            "unit_price",
            "item_discount",
            "category",
            "product",
            "product_id",
            "product_available",
            "market",
            "region",
            "warehouse_proxy",
            "shipping_mode",
            "order_status",
            "order_type",
        ]
    ].copy()
    cleaned["order_date"] = cleaned["order_date"].dt.strftime("%Y-%m-%d %H:%M:%S")
    cleaned["shipping_date"] = cleaned["shipping_date"].dt.strftime("%Y-%m-%d %H:%M:%S")

    print(f"Input rows: {initial_rows:,}; rows retained: {len(cleaned):,}")
    print(f"Rows removed for critical missing values: {initial_rows - len(cleaned):,}")
    print(f"Product availability flags: {int((~data['product_available']).sum()):,} unavailable rows")
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT if DEFAULT_INPUT.exists() else LEGACY_INPUT,
        help="Path to the raw DataCo CSV (defaults to data/raw, with a legacy data/ fallback).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Destination for the cleaned CSV.",
    )
    args = parser.parse_args()
    if not args.input.is_file():
        raise FileNotFoundError(
            f"Input CSV not found: {args.input}. Place it at {DEFAULT_INPUT} or pass --input."
        )

    raw = pd.read_csv(args.input, encoding="latin1", low_memory=False)
    cleaned = clean_data(raw)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_csv(args.output, index=False, na_rep="")
    print(f"Cleaned dataset saved to: {args.output.resolve()}")


if __name__ == "__main__":
    main()
