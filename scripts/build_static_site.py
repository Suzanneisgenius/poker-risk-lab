"""Build the public UI without embedding any server-side calculation engine."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STANDALONE = ROOT / "standalone"


def main() -> None:
    parts = [
        (STANDALONE / "build" / "shell.html").read_text(encoding="utf-8"),
        "\n<script>\n",
        (STANDALONE / "build" / "app.js").read_text(encoding="utf-8"),
        "\n</script></body></html>\n",
    ]
    page = "".join(parts)
    targets = [
        STANDALONE / "poker-analytics-suite.html",
        ROOT / "index.html",
        ROOT / "site" / "index.html",
    ]
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page, encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
