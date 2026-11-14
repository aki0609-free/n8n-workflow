import pytest

from data_processing.scraping import extract_links, extract_title, fetch_html

HTML = """
<html>
  <head><title>
    Example   Page
  </title></head>
  <body>
    <a href="/about">About <b>us</b></a>
    <a href="https://other.example/x">External</a>
    <a href="/about">Duplicate</a>
    <a href="mailto:hi@example.com">Mail</a>
    <a>No href</a>
  </body>
</html>
"""


def test_extract_title_collapses_whitespace():
    assert extract_title(HTML) == "Example Page"
    assert extract_title("<p>no title</p>") is None


def test_extract_links_resolves_dedupes_and_filters_schemes():
    assert extract_links(HTML, base_url="https://example.com/") == [
        {"url": "https://example.com/about", "text": "About us"},
        {"url": "https://other.example/x", "text": "External"},
    ]


def test_fetch_html_rejects_non_http_scheme():
    with pytest.raises(ValueError):
        fetch_html("file:///etc/passwd")
