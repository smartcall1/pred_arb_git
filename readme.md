# 🤖 Prediction & Arbitrage Bots

이 프로젝트는 스포츠 승부 예측과 아비트라지(차익거래) 기회를 찾는 봇들의 모음입니다.

---

## 📂 봇 목록

### 1. 🏀 스포츠 승리 예측 봇 (AI Analysis)
**Google Gemini AI**를 이용하여 **Predict.fun**과 **Polymarket**의 스포츠 경기를 분석하고, 승리 확률을 예측합니다.

- **실행 파일**: `index.mjs` (통합 실행)
- **구성 요소**:
    - `sports_bot.mjs`: Predict.fun 마켓 감지 및 분석
    - `sports_poly.mjs`: Polymarket (NBA, NFL) 마켓 감지 및 분석
- **기능**:
    - 신규 마켓 자동 감지
    - Gemini AI를 통한 승률 분석 (부상자, 전술, 모멘텀 등 고려)
    - 텔레그램 알림 전송 (시장 확률 vs AI 예측 확률 비교)

### 2. ⚖️ 아비트라지 봇 (Arbitrage Scanner)
두 사이트(Polymarket vs Predict.fun)의 가격 차이를 이용하여 무위험 수익 기회를 찾습니다.

- **실행 파일**: `arb_scan.mjs`
- **기능**: 
    - 60초마다 마켓 스캔
    - 유사한 마켓 매칭 (유사도 분석)
    - 확정 수익(ROI) 기회 발견 시 알림

---

## 🚀 실행 방법

### 필수 준비물
- **Node.js** (v20 이상 권장)
- **.env** 파일 설정:
  ```env
  PREDICT_FUN_API_KEY=내_키
  TELEGRAM_BOT_TOKEN=내_봇_토큰
  TELEGRAM_CHAT_ID=내_채팅_ID
  GOOGLE_API_KEY=내_GEMINI_API_키
  ```

### 명령어

#### 1. 스포츠 예측 봇 실행 (통합)
두 개의 예측 봇(Predict.fun + Polymarket)을 한 번에 실행합니다. (주로 GitHub Actions 스케줄러가 사용)
```bash
node index.mjs
```

#### 2. 아비트라지 봇 실행
무한 루프를 돌며 실시간으로 기회를 포착합니다.
```bash
node arb_scan.mjs
```

---

## 🛠️ GitHub Actions (자동화)
`.github/workflows/bot_schedule.yml`에 의해 **4시간마다** `index.mjs`가 자동으로 실행되어 신규 경기를 분석하고 알림을 보냅니다.

- **상태 저장**: 분석한 마켓 목록은 `analyzed_markets.json`에 저장되어 중복 분석을 방지합니다. 또한 GitHub Repo에 자동으로 커밋(Commit)됩니다.

---

## 📊 주요 로직 설명

### Prediction Bot (`sports_bot` & `sports_poly`)
1. **Fetch**: API를 통해 최신 마켓 정보를 가져옵니다. (거래량 필터링 적용)
2. **Filter**: 이미 분석한 마켓은 건너뜁니다 (`analyzed_markets.json` 확인).
3. **Analyze**: Gemini AI에게 경기 분석을 요청합니다.
4. **Notify**: 분석 결과를 텔레그램으로 전송합니다.
5. **Save**: 분석 완료된 마켓 ID를 저장합니다.

### Arbitrage Bot (`arb_scan`)
1. **Scan**: 양쪽 사이트의 마켓을 대량으로 수집합니다.
2. **Match**: 제목 유사도를 기반으로 동일한 이벤트를 찾습니다.
3. **Calculate**: Yes/No 가격의 합이 1 미만인 경우(차익 기회)를 찾습니다.
4. **Alert**: 수익률이 설정된 `ROI_THRESHOLD`를 넘으면 알림을 보냅니다.