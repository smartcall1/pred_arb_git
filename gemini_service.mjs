import { CONFIG } from "./config.mjs";
import { fetchJson, log, logError } from "./utils.mjs";

export const GeminiService = {
    /**
     * 경기를 분석하고, 승리 확률을 반환하는 함수입니다.
     * @param {object} market - 마켓 정보 전체 (질문 제목, 슬러그, 설명 등)
     * @returns {Promise<{teamA: string, teamB: string, probA: number, probB: number, reasoning: string, risks: string, sport: string}>}
     */
    async analyzeMatch(market) {
        // API 키가 있는지 먼저 확인합니다.
        if (!CONFIG.GOOGLE_API_KEY) {
            logError("Missing GOOGLE_API_KEY");
            return null;
        }

        const matchTitle = market.question;
        const slug = market.categorySlug || "";
        const desc = market.description || "";


        // "A vs B" 형태의 제목에서 팀 이름을 나눕니다.
        const parts = matchTitle.split(/ vs\.? /i);
        if (parts.length < 2) {
            return null; // 팀 이름을 파싱할 수 없으면 분석을 포기합니다.
        }
        const teamA = parts[0].trim();
        const teamB = parts[1].trim();
        const now = new Date().toLocaleDateString();

        // Gemini AI에게 보낼 명령문 (프롬프트) 작성
        // AI에게 "너는 스포츠 분석가야"라고 역할을 부여하고, 데이터를 분석하라고 시킵니다.
        const prompt = `
# Role: 최첨단 스포츠 데이터 분석가 및 베팅 전략 전문가 (Predictive Analyst)

# Mission: 
제공된 두 팀([${teamA}] vs [${teamB}])의 경기에 대해 실시간 최신 정보를 수집하고, 지정학적·역사적·전술적 변수를 종합하여 양 팀의 최종 승리 확률을 산출하라. 
(단, 두 팀의 확률 합은 반드시 100%가 되어야 함)

# Context:
- 오늘 날짜: ${now}
- 분석 대상: ${matchTitle}
- 카테고리 정보(Slug): ${slug} (이 정보를 통해 리그/종목을 식별할 것)
- 상세 설명: ${desc}

# Language: 
All analysis(reasoning, risks) must be written in **Korean** (한국어).

# Execution Process (반드시 아래 단계를 거쳐 분석할 것):

1. **Step 1: 종목 및 리그 식별 (Identification)**
   - team names와 categorySlug("${slug}")를 단서로 어떤 종목(예: 농구, 미식축구 등)이며, 어떤 리그(예: NBA, NFL 등)인지 명확히 식별하라.
   - 예: "Minnesota vs Detroit"가 NBA인지 NFL인지 구분할 때 slug에 'nfl'이 있는지 확인하라.

2. **Step 2: 실시간 최신 정보 수집 (Real-time Search)**
   - 식별된 종목/리그에 맞춰, 오늘 날짜 기준 양 팀의 최신 뉴스(부상자, 라인업, 이동 거리 등)를 검색하라.
   - **중요**: Pinnacle, bet365, Betfair 등 주요 해외 베팅 사이트 및 Polymarket에서 해당 매치에 대해 현재 형성된 배당률(Odds)과 승리 확률을 반드시 검색하여 참고하라. 시장의 예측은 매우 중요한 지표이다.

3. **Step 3: 데이터 분석 및 확률 산출**
   - 전력차, 홈/원정 이점, 상대 전적 등을 종합하여 승리 확률을 산출하라.


# Output Format (JSON Only):
Respond ONLY with a valid JSON object. No markdown, no other text.
IMPORTANT: All text fields(reasoning, risks) MUST be written in Korean.
{
  "sport": "종목명 (예: NBA, NFL, EPL)",
  "teamA": "${teamA}",
  "teamB": "${teamB}",
  "probA": 00.0,
  "probB": 00.0,
  "reasoning": "요약된 분석 근거 (3줄 이내)",
  "risks": "핵심 변수 2가지 (짧게)"
}
`;

        const safeKey = CONFIG.GOOGLE_API_KEY ? CONFIG.GOOGLE_API_KEY.trim() : "";
        // 'gemini-2.0-flash-exp' 모델을 사용하여 웹 버전과 유사한 최신 성능을 활용합니다.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${safeKey}`;

        try {
            // API 요청 본문 (Body)
            const body = {
                contents: [{ parts: [{ text: prompt }] }],
                tools: [{ google_search: {} }] // Google Search Grounding 도구 활성화
            };

            // 구글 서버로 요청 전송
            const response = await fetchJson(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });

            // 응답이 올바르지 않으면 에러 처리
            if (!response || !response.candidates || !response.candidates[0].content) {
                logError("Gemini Invalid Response", {
                    status: response?.status,
                    error: response?.error,
                    full: JSON.stringify(response)
                });
                return null;
            }

            // AI의 응답 텍스트 추출
            const text = response.candidates[0].content.parts[0].text;

            // JSON 형식이 아닌 마크다운 기호(```json) 등을 제거하여 깨끗한 텍스트로 만듦
            const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();

            const data = JSON.parse(cleanText);

            // 확률 합이 100%가 되도록 보정 (오차가 있을 경우)
            const sum = data.probA + data.probB;
            if (Math.abs(sum - 100) > 1) {
                // 비율에 맞춰 다시 계산
                data.probA = (data.probA / sum) * 100;
                data.probB = (data.probB / sum) * 100;
            }

            return data;

        } catch (e) {
            logError(`Gemini Analysis Failed for ${matchTitle}`, e);
            return null;
        }
    }
};
