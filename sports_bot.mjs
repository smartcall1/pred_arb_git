import { CONFIG } from "./config.mjs";
import { sleep, log, logError, loadState, saveState } from "./utils.mjs";
import { PredictApi } from "./predict_api.mjs";
import { GeminiService } from "./gemini_service.mjs";
import { TelegramService } from "./telegram_service.mjs";

// 이미 분석한 마켓인지 기억하기 위한 저장소 (중복 분석 방지)
// 이미 분석 완료한 마켓을 저장합니다. (거래량 미달로 건너뛴 마켓은 여기에 저장하지 않습니다)
const analyzedMarkets = new Set();
// 봇이 처음 켜졌는지 확인하는 변수
let isFirstRun = true;

// 봇의 메인 반복 루프 함수
async function runLoop() {
    log("🏀 스포츠 예측 봇 루프 시작...");

    try {
        // 1. 현재 열려있는 스포츠 마켓들을 가져옵니다.
        const markets = await PredictApi.fetchSportsMarkets();
        log(`활성화된 스포츠 마켓 ${markets.length}개를 찾았습니다.`);

        const newMarkets = [];

        for (const market of markets) {
            // 이미 분석을 마친 마켓이 아니라면?
            if (!analyzedMarkets.has(market.id)) {
                // 처리할 목록(newMarkets)에 추가합니다.
                newMarkets.push(market);
            }
        }

        // 새로운 마켓이 있다면 처리 시작
        if (newMarkets.length > 0) {
            if (isFirstRun) {
                // 첫 실행이면: 발견된 모든 마켓을 분석합니다.
                log(`시작: 분석 대기 마켓 ${newMarkets.length}개를 찾았습니다.`);
            } else {
                // 실행 중이면
                log(`🆕 ${newMarkets.length}개의 분석 대기 마켓 발견!`);
            }

            // 각 마켓을 하나씩 순서대로 분석합니다.
            for (const market of newMarkets) {
                const analyzed = await processNewMarket(market);
                // 분석이 성공적으로 완료되었다면 기록합니다.
                if (analyzed) {
                    analyzedMarkets.add(market.id);
                }

                // Gemini API가 너무 많이 요청받아 힘들어하지 않게 20초 정도 쉽니다. (429 에러 방지)
                await sleep(20000);
            }
        } else {
            log(isFirstRun ? "시작: 분석할 스포츠 마켓이 없습니다." : "새로운 마켓이 없습니다.");
        }

        // 첫 실행이 끝났으므로 false로 변경
        isFirstRun = false;

    } catch (e) {
        logError("루프 실행 중 오류 발생", e);
    }
}

// 개별 마켓을 분석하고 알림을 보내는 함수 (반환값: true면 분석 완료, false면 스킵)
async function processNewMarket(market) {
    log(`검고 중: ${market.question}`);

    try {
        // 1. 거래량 정보 확인 (가장 먼저 체크)
        const stats = await PredictApi.getMarketStats(market.id);
        const volume = stats?.volumeTotalUsd || 0;
        const volStr = `$${Math.round(volume).toLocaleString()}`;

        // 거래량이 기준 미달이면 스킵
        if (volume < CONFIG.MIN_VOLUME_USD) {
            log(`SKIP: 거래량 부족 (${volStr} < $${CONFIG.MIN_VOLUME_USD.toLocaleString()}) - ${market.question}`);
            return false;
        }

        log(`분석 시작: 거래량 충족 (${volStr}) - ${market.question}`);

        // 2. Predict.fun에서 현재 베팅 배당률(가격) 정보를 가져옵니다.
        const odds = await PredictApi.getMarketOdds(market.id);

        let predMarketStr = "정보 없음";

        // "Team A vs Team B" 형태의 제목에서 팀 이름을 추출합니다.
        const parts = market.question.split(/ vs /i);
        const pTeamA = parts[0] ? parts[0].trim() : "Team A";
        const pTeamB = parts[1] ? parts[1].trim() : "Team B";

        // 배당률 정보가 있다면 확률로 변환하여 표시합니다.
        if (odds && odds.yesPrice !== null) {
            const pA = (odds.yesPrice * 100).toFixed(0);
            const pB = (odds.noPrice * 100).toFixed(0);
            predMarketStr = `${pTeamA} ${pA}% / ${pTeamB} ${pB}%`;
        }

        // 3. Gemini AI에게 이 경기의 승률 분석을 요청합니다. (마켓 정보 전체를 전달)
        const aiPred = await GeminiService.analyzeMatch(market);

        // AI가 분석에 성공했다면?
        if (aiPred) {
            // 4. 텔레그램 메시지를 예쁘게 꾸밉니다.
            // [종목명] 질문 제목 [vol : $XXX]
            // PREDICT : ...
            // GEMINI : ...

            const sportTag = aiPred.sport ? `[${aiPred.sport}]` : "[SPORTS]";

            // AI가 예측한 확률 라인
            const aiLine = `${aiPred.teamA} ${aiPred.probA.toFixed(0)}% / ${aiPred.teamB} ${aiPred.probB.toFixed(0)}%`;


            const message = `
[🎫PREDICT.FUN]
${sportTag} ${market.question} [vol : ${volStr}]
PREDICT : ${predMarketStr}
GEMINI  : ${aiLine}

💡 [ Analysis ] (분석 결과)
${aiPred.reasoning}

⚠️ [ Risks ] (주의할 점)
${aiPred.risks}
`;
            log(`${market.question}에 대한 알림을 전송합니다.`);
            await TelegramService.send(message);
            return true; // 분석 및 전송 완료
        } else {
            log(`알림 건너뜀: Gemini가 ${market.question} 분석에 실패했습니다.`);
            return false; // 분석 실패 (다음 루프에서 다시 시도할지 여부는 정책 나름이지만, 여기서는 다시 시도하도록 false 반환)
        }

    } catch (e) {
        logError(`${market.id}번 마켓 처리 실패`, e);
        return false;
    }
}

// 프로그램 시작 지점 (Entry Point)

// 메인 실행 로직을 함수로 분리 및 export
export async function run() {
    log("=== 스포츠 예측 봇 가동 시작 (GitHub Actions Mode) ===");

    // 0. 이전 상태(이미 분석한 마켓 목록)를 불러옵니다.
    const STATE_FILE = "analyzed_markets.json";
    const state = await loadState(STATE_FILE);

    // analyzedMarkets Set을 복구합니다.
    if (state.predict_fun && Array.isArray(state.predict_fun)) {
        state.predict_fun.forEach(id => analyzedMarkets.add(id));
        log(`기존 분석 기록 ${analyzedMarkets.size}개를 불러왔습니다.`);
    }

    // 1. 한번 실행 (Run Once)
    await runLoop();

    // 2. 현재 상태(이번에 분석한 마켓 포함)를 파일에 저장합니다.
    state.predict_fun = Array.from(analyzedMarkets);
    await saveState(STATE_FILE, state);
    log(`분석 기록을 저장했습니다. (총 ${analyzedMarkets.size}개)`);

    log("=== 봇 종료 ===");
}

// 직접 실행되었을 때만 run() 실행
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run();
}
