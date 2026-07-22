"""Research experiments — runnable independently of the Streamlit product.

Each experiment is a pure library function plus a thin CLI (``main``) that reads a
config, runs the computation, and writes tables/figures/provenance to ``reports/``.
Nothing here imports Streamlit.
"""
