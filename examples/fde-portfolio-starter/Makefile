.PHONY: install test run docker lint

install:
	pip install -r requirements.txt

test:
	pytest -q

run:
	uvicorn app.main:app --reload

docker:
	docker build -t portfolio-starter . && docker run -p 8000:8000 portfolio-starter

lint:
	ruff check .
