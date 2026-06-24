# portfolio-starter — Messy-Input → Structured-Outcome Agent API

> **これはあなたの「訓練場テンプレ」**です。完成品ではありません。`〇〇` を埋め、機能を足し、
> デプロイして公開 URL を出すところまで持っていくことで、FDE が見たい「**本番コードをゼロから書ける**」を証明します。
> （FDE 採用が最初に見るのは GitHub。README だけでなく**動く実物**で「本番コードをゼロから書ける」を示すための最小スカフォールドです。）

## 何をするか（顧客課題）

雑多な入力（問い合わせメール・CSV 抜粋・PDF からのテキスト）を受け取り、
**構造化データ＋次アクション＋信頼度**を返す API。FDE が顧客現場で最初にやる
「散らかった現実 → 動く価値」を最小構成で体現する。

```
POST /extract  { "text": "..." }  ->  { summary, entities, action_items[], priority, confidence }
GET  /health   ->  { status: "ok" }
```

## 設計のポイント（採用担当に効く「なぜ」）

- **API キー無しでも動く**: `ANTHROPIC_API_KEY` が無ければ決定論的フォールバックで動作。
  → CI/eval をシークレット無しで回せる = 「本番前に壊れを捕まえる」評価可能な設計（FDE の核）。
- **型で守る**: pydantic でリクエスト/レスポンスを検証。
- **評価がある**: `evals/` にゴールデンセットと回帰テスト。
- **再現可能**: Docker / `.env.example`。

## クイックスタート（runbook）

```bash
# 1) セットアップ
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2) テスト/評価（APIキー不要・決定論フォールバックで実行）
pytest -q

# 3) ローカル起動
uvicorn app.main:app --reload
#   別ターミナル:
curl -s localhost:8000/health
curl -s localhost:8000/extract -H 'content-type: application/json' \
  -d '{"text":"至急: 田中様(tanaka@example.com)から見積もり依頼。明日まで。"}' | python -m json.tool

# 4) 本物の LLM を使う（任意）
export ANTHROPIC_API_KEY=sk-...
export MODEL=claude-sonnet-4-6   # 最も高性能は claude-opus-4-8

# 5) Docker
docker build -t portfolio-starter . && docker run -p 8000:8000 portfolio-starter
```

## あなたの「次の一手」（TODO — ここを埋めると差がつく）

- [ ] LLM 経路の出力を JSON スキーマ(tool use)で厳格化し、フォールバックと整合させる
- [ ] `evals/` にゴールデン事例を 10→30 件に増やし、精度/再現率を計測して README に数値を載せる
- [ ] Cloud Run / Fly.io にデプロイし**公開 URL** を README 冒頭に貼る
- [ ] 2–3 分のデモ動画を撮って埋め込む
- [ ] 入力を PDF/CSV に拡張（messy-input の幅を広げる）
- [ ] レート制限・APIキー認証・観測性(ログ/メトリクス)を足す
- [ ] GitHub Actions で `pytest` + lint を CI 化（バッジを貼る）

> ⚠️ このテンプレは**新しい独立リポ**にコピーして育てるのがおすすめ（プロフィールリポを汚さない & FDE 用の単体リポとして見せやすい）。
