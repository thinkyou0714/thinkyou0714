# Owner tasks — 人間が適用する GitHub 設定

このリポジトリの **オーナーだけ** が適用できる GitHub 設定の一覧です。CI やエージェント
(このセッションの MCP API)からは設定できないため、ここに **優先度順** で保管します。
完了したらチェックを入れてください。各項目の背景は [`CI.md`](CI.md) の
"Repository settings" と [`agmsg-ideas.md`](agmsg-ideas.md)(#252–259, #283–286)にもあります。

> `gh` コマンドはお手元の端末用です(リモート実行環境からは適用できません)。

## P0 — これが全ての前提

- [ ] **PR #14 をマージ。** ラウンド 1〜5 はマージして初めて `main` に反映されます
      (プロフィール README 更新・ワークフローバッジ・Scorecard 初回実走)。

  ```bash
  gh pr ready 14 && gh pr merge 14 --squash --delete-branch
  ```

## P1 — 高価値・約1分・リスクなし

- [ ] **About に topics・description・homepage を設定**(発見性の最大レバー。検索は topics をインデックスします)。

  ```bash
  gh repo edit thinkyou0714/thinkyou0714 \
    --description "Profile + governance repo: agmsg multi-agent coordination & self-validating CI/supply-chain hardening" \
    --homepage "https://github.com/thinkyou0714" \
    --add-topic claude-code --add-topic agentic-workflow --add-topic multi-agent \
    --add-topic github-actions --add-topic ai-automation --add-topic governance \
    --add-topic developer-tooling --add-topic agmsg
  ```

- [ ] **Secret scanning の push protection を有効化**(パブリックは無料・予防)。
      *Settings → Code security → Secret scanning → Push protection → Enable.*

## P2 — 高価値・マージ直後に

- [ ] **`main` のブランチ保護 / ルールセット**で 4 ゲート(`lint` / `secrets-scan` /
      `dependency-review` / `codeql`)を必須化。マージ**後**に実施(`main` 上にチェックが
      出来てから選択)。⚠️ ソロ運用のため自分はバイパス可に(PR レビュー必須にしない)。
      *Settings → Rules → Rulesets → New branch ruleset.*
- [ ] **ピン留めリポジトリの整理**(agmsg / ccmux / github-flow-kit / public-docs /
      zenn-content / lab-public)。*Profile → Customize your pins.*

## P3 — あると良い

- [ ] **Discussions を有効化**(issue の `config.yml` が誘導先にしています)。

  ```bash
  gh api --method PATCH /repos/thinkyou0714/thinkyou0714 -F has_discussions=true
  ```

- [ ] **OpenSSF Best Practices の自己認証** — [bestpractices.dev](https://www.bestpractices.dev/)
      (一度きりのアンケート。既に体現している姿勢を外部に示せます)。
- [ ] **ソーシャルプレビュー画像**(1280×640)でリンク展開の見栄え向上。
      *Settings → Social preview.*

## P4 — 装飾的 / 任意

- [ ] 飾りの「Dependabot Updates」エントリを無効化(UI のみ・ジョブは走りません)。
- [ ] Scorecard 初回実走後、任意で `--publish` を有効化して公開スコアバッジを表示
      (スコアが公開されます。※コード側で対応可能)。
- [ ] ハンズフリーで agmsg 参加したいなら、マシンごとに `AGMSG_AUTO_BOOTSTRAP=1` を設定。

---

_コード側から補助できるのは 2 件: ブランチ保護ルールセットの JSON(P2)と
Scorecard 公開バッジ対応(P4)。必要なら声をかけてください。_
