"""Record cleaning utilities.

`clean_records` は n8n の items から取り出した dict のリストを受け取り、
文字列のトリム・空値の除去・日付の ISO 8601 正規化・キーによる重複排除を行う。
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any

DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S")


def normalize_date(value: Any) -> str | None:
    """Parse a date string in common formats and return YYYY-MM-DD, or None."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        return datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        pass
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def clean_value(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def clean_records(
    records: Iterable[dict[str, Any]],
    *,
    key: str | None = None,
    date_fields: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """Clean a list of records.

    - 文字列は前後空白を除去し、空文字は None にする
    - None のフィールドは除去する
    - ``date_fields`` に指定したフィールドは YYYY-MM-DD に正規化する（解釈不能なら除去）
    - ``key`` を指定した場合、その値が同じレコードは最初の 1 件のみ残す（key 欠落レコードは除外）
    """
    date_fields = set(date_fields)
    seen: set[Any] = set()
    result: list[dict[str, Any]] = []

    for record in records:
        cleaned: dict[str, Any] = {}
        for field, raw in record.items():
            value = normalize_date(raw) if field in date_fields else clean_value(raw)
            if value is not None:
                cleaned[field] = value

        if key is not None:
            identity = cleaned.get(key)
            if identity is None or identity in seen:
                continue
            seen.add(identity)

        result.append(cleaned)

    return result
