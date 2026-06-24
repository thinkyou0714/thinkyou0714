"""FastAPI surface. Small on purpose — the value is the typed contract + the agent."""
from __future__ import annotations

from fastapi import FastAPI

from . import __version__
from .agent import extract
from .schemas import ExtractRequest, ExtractResult

app = FastAPI(
    title="Messy-Input → Structured-Outcome API",
    version=__version__,
    summary="FDE portfolio starter: turn ambiguous text into structured, actionable data.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.post("/extract", response_model=ExtractResult)
def extract_endpoint(req: ExtractRequest) -> ExtractResult:
    return extract(req.text)
