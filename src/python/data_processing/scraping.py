"""Lightweight HTML scraping helpers (standard library only)."""

from __future__ import annotations

import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

DEFAULT_USER_AGENT = "n8n-data-processing/0.1 (+https://n8n.io)"


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._in_title = False
        self._current_href: str | None = None
        self._current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        elif tag == "a":
            href = dict(attrs).get("href")
            if href:
                self._current_href = href
                self._current_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "a" and self._current_href is not None:
            text = " ".join("".join(self._current_text).split())
            self.links.append((self._current_href, text))
            self._current_href = None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)
        if self._current_href is not None:
            self._current_text.append(data)


def _parse(html: str) -> _PageParser:
    parser = _PageParser()
    parser.feed(html)
    parser.close()
    return parser


def extract_title(html: str) -> str | None:
    title = " ".join("".join(_parse(html).title_parts).split())
    return title or None


def extract_links(html: str, base_url: str | None = None) -> list[dict[str, str]]:
    """Return unique http(s) links as ``[{"url": ..., "text": ...}]`` in document order."""
    seen: set[str] = set()
    links: list[dict[str, str]] = []
    for href, text in _parse(html).links:
        url = urljoin(base_url, href) if base_url else href
        if urlparse(url).scheme not in ("http", "https") or url in seen:
            continue
        seen.add(url)
        links.append({"url": url, "text": text})
    return links


def fetch_html(url: str, *, timeout: float = 10.0, user_agent: str = DEFAULT_USER_AGENT) -> str:
    """Fetch a page and decode it using the declared charset (fallback: utf-8)."""
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError(f"unsupported URL scheme: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def scrape(url: str, **kwargs) -> dict[str, object]:
    html = fetch_html(url, **kwargs)
    return {"url": url, "title": extract_title(html), "links": extract_links(html, base_url=url)}
