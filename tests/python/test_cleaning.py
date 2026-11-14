import io
import json

import pytest

from data_processing.__main__ import main
from data_processing.cleaning import clean_records, normalize_date


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2024-03-05", "2024-03-05"),
        ("2024/03/05", "2024-03-05"),
        ("2024.3.5", "2024-03-05"),
        ("05-03-2024", "2024-03-05"),
        ("2024-03-05T10:20:30", "2024-03-05"),
        ("not a date", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_date(raw, expected):
    assert normalize_date(raw) == expected


def test_clean_records_trims_drops_empty_and_dedupes():
    records = [
        {"id": 1, "name": "  Alice ", "note": "   ", "joined": "2024/01/02"},
        {"id": 1, "name": "Alice duplicate"},
        {"id": None, "name": "No id"},
        {"id": 2, "name": "Bob", "joined": "garbage"},
    ]
    assert clean_records(records, key="id", date_fields=["joined"]) == [
        {"id": 1, "name": "Alice", "joined": "2024-01-02"},
        {"id": 2, "name": "Bob"},
    ]


def test_clean_records_without_key_keeps_all():
    assert clean_records([{"a": " x "}, {"a": " x "}]) == [{"a": "x"}, {"a": "x"}]


def test_cli_clean(monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps([{"id": 1}, {"id": 1}])))
    assert main(["clean", "--key", "id"]) == 0
    assert json.loads(capsys.readouterr().out) == [{"id": 1}]
