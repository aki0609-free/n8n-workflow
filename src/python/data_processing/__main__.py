"""CLI entrypoint: JSON in (stdin) → JSON out (stdout).

n8n の Execute Command ノードや外部ワーカーから呼び出す想定。

    echo '[{"name":" a ","id":1},{"id":1}]' | python -m data_processing clean --key id
    python -m data_processing scrape https://example.com
"""

from __future__ import annotations

import argparse
import json
import sys

from data_processing.cleaning import clean_records
from data_processing.scraping import scrape


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="data_processing")
    sub = parser.add_subparsers(dest="command", required=True)

    clean = sub.add_parser("clean", help="clean a JSON array of records read from stdin")
    clean.add_argument("--key", help="field used for de-duplication")
    clean.add_argument("--date-field", action="append", default=[], help="field to normalize")

    scrape_cmd = sub.add_parser("scrape", help="fetch a URL and extract title and links")
    scrape_cmd.add_argument("url")
    scrape_cmd.add_argument("--timeout", type=float, default=10.0)

    args = parser.parse_args(argv)

    if args.command == "clean":
        records = json.load(sys.stdin)
        if not isinstance(records, list):
            parser.error("stdin must be a JSON array of objects")
        output = clean_records(records, key=args.key, date_fields=args.date_field)
    else:
        output = scrape(args.url, timeout=args.timeout)

    json.dump(output, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
