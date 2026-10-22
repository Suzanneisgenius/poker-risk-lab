"""Poker Bankroll Risk Simulator — core package.

Modules
-------
simulation      Vectorized Monte Carlo bankroll engine (absorbing ruin).
analytics       Pure risk / drawdown / growth / time-to-ruin estimators.
validation      Analytical (Brownian) and Markov-chain cross-checks.

Every reported number is reproducible from a fixed seed via SimulationConfig.
"""

__version__ = "0.1.0"
