// scan_fix2.mjs
// =========================================================
// [아비트라지 봇] - 상세 설명서 버전 (초보자용) 📘
//
// 안녕하세요! 이 코드는 두 개의 예측 시장 사이트(Polymarket, Predict.fun)를 실시간으로 감시하다가,
// "가격 차이"를 이용해서 돈을 벌 수 있는 기회(아비트라지)가 생기면
// 텔레그램으로 즉시 알려주는 똑똑한 로봇(봇)입니다.
//
// 코드를 잘 모르셔도 괜찮습니다! 각 부분이 무슨 역할을 하는지 아주 쉽게 설명해드릴게요.
// 천천히 읽어보세요. ^^
// =========================================================

// 1. [도구 준비] 필요한 도구들을 가져옵니다.
import "dotenv/config"; // .env 파일에 적힌 비밀번호(API 키)를 몰래 가져오는 도구입니다.
import crypto from "crypto"; // 알림이 중복으로 오지 않게 '지문(Hash)'을 만드는 도구입니다.
// import fs from "fs"; // 로그를 파일(scan_log.txt)에 저장하기 위한 도구입니다. (비활성화됨)

// ---------------------------------------------------------
// 2. [설정값] 봇이 동작하는 규칙을 정합니다.
// ---------------------------------------------------------
const PRED_KEY = process.env.PREDICT_FUN_API_KEY; // Predict.fun 사이트 접속 열쇠(API 키)
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;  // 내 봇의 비밀번호 (텔레그램)
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;     // 알림을 받을 채팅방 번호

// 만약 열쇠가 없으면 "없어요!" 라고 알려주고 봇을 멈춥니다.
if (!PRED_KEY) throw new Error("Predict.fun API 키가 없어요! (.env 파일을 확인해주세요)");
if (!TG_TOKEN) throw new Error("텔레그램 봇 토큰이 없어요!");
if (!TG_CHAT) throw new Error("텔레그램 채팅 ID가 없어요!");

// 숫자 설정들 (취향에 맞게 바꾸셔도 됩니다)
const ROI_THRESHOLD = Number(process.env.ROI_THRESHOLD ?? "0.005"); // 목표 수익률 (0.005 = 0.5% 이득이면 알림)
const LOOP_MS = Number(process.env.LOOP_MS ?? "60000"); // 얼마나 자주 검사할까요? (60000ms = 60초)
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS ?? "900000"); // 같은 알림은 15분(900000ms) 동안 다시 안 보냅니다.
const POLY_LIMIT = 20000; // Polymarket에서 가져올 마켓 개수 (거래량 많은 순)
const PRED_LIMIT = 1500; // Predict.fun에서 가져올 마켓 개수 (최신순)
const MAX_MATCHES_PER_LOOP = 120; // 한 번에 너무 많이 검사하면 느려지니 120개까지만 가격 비교
const MATCH_THRESHOLD = 0.6; // 제목이 얼마나 비슷해야 같은 마켓으로 칠까요? (0.35점 이상)
const PRED_MIN_GAP_MS = 250; // Predict.fun 사이트에 너무 빨리 접속하면 차단당하니 0.25초씩 텀을 둡니다.

// const logFile = "scan_log.txt"; // 기록을 저장할 파일 이름 (비활성화됨)

// ---------------------------------------------------------
// 3. [도우미 함수] 봇을 도와주는 작은 기능들
// ---------------------------------------------------------

// 로그 출력 함수: 화면에도 보여주고, 파일에도 적어둡니다.
const log = (msg) => {
    console.log(msg); // 화면에 출력
    // try { fs.appendFileSync(logFile, msg + "\n"); } catch (e) { } // 파일에 저장 (비활성화됨)
};

// 시작할 때 로그 파일 내용을 싹 비웁니다. (새출발!)
// fs.writeFileSync(logFile, ""); (비활성화됨)

// 잠시 쉬는 함수 (컴퓨터도 휴식이 필요해요)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [핵심 기능] 제목 정리하기 & 동의어 번역기 🧠
// "Will Bitcoin hit $100k?" 같은 문장을 컴퓨터가 이해하기 쉽게 단어들로 쪼갭니다.
const tokenize = (s) => {
    let clean = (s || "").toLowerCase(); // 모든 글자를 소문자로 바꿉니다 (대소문자 무시)

    // [동의어 사전] 서로 다른 단어지만 뜻이 같은 경우 통일시켜줍니다.
    // 예: "12월 31일"과 "연말(EOY)"은 같은 뜻이죠?
    const synonyms = [
        ["bitcoin", "btc"],           // BTC -> bitcoin
        ["ethereum", "eth"],          // ETH -> ethereum
        ["december 31", "eoy"],       // December 31 -> eoy (End Of Year)
        ["dec 31", "eoy"],            // Dec 31 -> eoy
        ["end of 2025", "eoy 2025"],  // End of 2025 -> eoy 2025
        ["end of the year", "eoy"],
        ["us dollar", "usd"],
        ["presidential", "president"],
        ["champions league", "ucl"],
        ["premier league", "epl"]
    ];

    // 사전을 뒤져서 단어를 바꿔치기 합니다.
    synonyms.forEach(([standard, ...vars]) => {
        vars.forEach(v => {
            clean = clean.split(v).join(standard);
        });
    });

    // 쓸모없는 단어(will, the, is 등)와 특수문자를 지웁니다.
    clean = clean
        .replace(/\b(will|be|the|a|an|at|by|on|to|in|of|for|with|is|are|was|were)\b/g, "")
        .replace(/\b(market|cap|world|company)\b/g, "") // '마켓', '회사' 같은 너무 흔한 단어도 뺍니다.
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    // 남은 알짜배기 단어들을 목록으로 만듭니다.
    return new Set(clean.split(" ").filter(w => w.length > 0));
};

// [핵심 기능] 두 문장이 얼마나 비슷한지 점수 매기기 (자카드 유사도) 📏
// 0점(완전 다름) ~ 1점(완전 똑같음) 사이의 점수를 줍니다.
const calcJaccard = (str1, str2) => {
    const setA = tokenize(str1); // 첫 번째 문장 단어들
    const setB = tokenize(str2); // 두 번째 문장 단어들

    let intersection = 0; // 겹치는 단어 개수
    setA.forEach(word => { if (setB.has(word)) intersection++; });

    const union = new Set([...setA, ...setB]).size; // 전체 단어 개수

    // 공식: (겹치는 개수) 나누기 (전체 개수)
    return union === 0 ? 0 : intersection / union;
};

// 알림이 중복되지 않게 제목으로 고유한 '지문'을 만듭니다.
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

// 인터넷 주소(URL)로 접속해서 정보를 가져오는 함수
// 가끔 실패하면 3번까지 다시 시도해봅니다. (끈기!)
async function fetchJson(url, opts = {}, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, opts);
            if (res.ok) { // 성공!
                const text = await res.text();
                return text ? JSON.parse(text) : null;
            }
            if (res.status === 404) return null; // 페이지 없음

            // 서버가 바쁘거나 에러가 나면 잠시 쉬었다가 재시도
            const isRetryable = [429, 500, 502, 503, 504].includes(res.status);
            if (!isRetryable || i === retries) throw new Error(`${res.status} ${url}`);

            const backoff = Math.min(5000, 400 * Math.pow(2, i)); // 0.4초, 0.8초, 1.6초... 점점 길게 대기
            await sleep(backoff);
        } catch (e) {
            if (i === retries) throw e; // 3번 다 실패하면 포기 ㅠㅠ
            await sleep(1000);
        }
    }
}

// 텔레그램으로 메시지를 쏘는 함수 🚀
async function tgSend(text) {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    try {
        await fetchJson(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
        });
    } catch (e) {
        console.error("텔레그램 전송 실패:", e.message);
    }
}

// ---------------------------------------------------------
// 4. [데이터 수집] 마켓 정보를 긁어오는 곳
// ---------------------------------------------------------

// Polymarket에서 마켓 가져오기
async function getPolyMarkets() {
    const allData = [];
    let offset = 0;

    // API가 한 번에 최대 500개까지만 주는 것 같아서 끊어서 가져옵니다.
    const BATCH_SIZE = 500;

    // 사용자에게 진행상황을 알려줍니다.
    process.stdout.write(`  [작업중] Polymarket 데이터 수집 시작... (목표: ${POLY_LIMIT}개)`);

    while (allData.length < POLY_LIMIT) {
        const left = POLY_LIMIT - allData.length;
        const limit = Math.min(left, BATCH_SIZE);

        const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&order=volume&ascending=false&offset=${offset}`;
        const data = await fetchJson(url);

        if (!data || !Array.isArray(data) || data.length === 0) break;

        allData.push(...data);
        offset += data.length;

        process.stdout.write(`\r  [작업중] Polymarket 데이터 수집 중... (${allData.length}/${POLY_LIMIT}개 완료)`);

        if (data.length < limit) break; // 더 이상 데이터가 없으면 중단
        await sleep(100); // API 과부하 방지
    }
    console.log(""); // 줄바꿈

    return allData
        .map((m) => {
            let yesId = null, noId = null;

            // YES와 NO의 고유 번호(ID)를 찾습니다. (이게 있어야 가격을 조회함)
            if (m.clobTokenIds) {
                let ids = m.clobTokenIds;
                if (typeof ids === 'string') {
                    try { ids = JSON.parse(ids); } catch (e) { ids = null; }
                }
                if (Array.isArray(ids) && ids.length >= 2) {
                    yesId = ids[0];
                    noId = ids[1];
                }
            }

            // 혹시 위에서 못 찾았으면 다른 곳(tokens)도 뒤져봅니다.
            if (!yesId) yesId = m.tokens?.[0]?.tokenId;
            if (!noId) noId = m.tokens?.[1]?.tokenId;

            return {
                id: m.id || m.conditionId,
                question: m.question || m.title, // 질문 제목
                yes: yesId,
                no: noId,
                volume: Number(m.volume || 0) // 거래량 정보도 챙깁니다
            };
        })
        .filter((x) => x.question && x.yes && x.no) // 정보가 온전한 것만 골라냅니다.
        .sort((a, b) => b.volume - a.volume); // 거래량 많은 순으로 줄 세웁니다.
}

// Polymarket 가격표(오더북) 가져오기
async function getPolyBook(tokenId) {
    if (!tokenId) return null;
    return fetchJson(`https://clob.polymarket.com/book?token_id=${tokenId}`);
}

// Polymarket에서 "살 수 있는 가장 싼 가격" 찾기
function bestPxPoly(book) {
    const bidObj = book?.bids?.[0]; // 누군가 사겠다고 올린 가장 비싼 가격
    const askObj = book?.asks?.[0]; // 누군가 팔겠다고 올린 가장 싼 가격 (우리는 이걸 사야 함!)
    return {
        bestBid: bidObj?.price != null ? Number(bidObj.price) : null,
        bestAsk: askObj?.price != null ? Number(askObj.price) : null
    };
}

// Predict.fun에서 마켓 가져오기 (REST API로 롤백 🔙)
// API가 거래량 정렬을 안 해줘서 최신순으로 가져옵니다.
async function getPredMarkets() {
    const allData = [];
    let cursor = null; // 책갈피(다음 페이지 위치)
    let keepGoing = true;
    const perPage = 50; // 한 번에 50개씩

    while (keepGoing && allData.length < PRED_LIMIT) {
        let url = `https://api.predict.fun/v1/markets?first=${perPage}`;
        if (cursor) url += `&after=${cursor}`; // 책갈피가 있으면 거기서부터 이어받기

        const res = await fetchJson(url, { headers: { "x-api-key": PRED_KEY } });
        const markets = res?.data || [];
        const nextCursor = res?.cursor;

        if (markets.length === 0) {
            keepGoing = false;
            break;
        }

        allData.push(...markets);

        // 너무 조용하면 심심하니까 100개 모을 때마다 알려줍니다.
        if (allData.length % 100 === 0) {
            process.stdout.write(`\r  [작업중] Predict.fun 수집 중... (${allData.length}개)`);
        }

        if (!nextCursor) {
            keepGoing = false; // 더 이상 페이지가 없으면 끝!
        } else {
            cursor = nextCursor; // 다음 책갈피 저장
        }

        await sleep(100); // 너무 빨리 요청하면 혼나니까 조금 쉽니다.
    }
    console.log(""); // 줄바꿈

    // 다 가져왔으면 필터링: 이미 끝난 게임은 제외합니다.
    const active = allData.filter(m => m.status !== 'RESOLVED' && m.status !== 'CLOSED');
    log(`  [필터링] Pred 전체 ${allData.length}개 중 활성 마켓 ${active.length}개 (종료된 ${allData.length - active.length}개 제외)`);

    return active
        .map((m) => ({
            id: m.id,
            question: m.question || m.title
        }))
        .filter((x) => x.id && x.question);
}

let lastPredCallAt = 0; // 마지막으로 요청한 시간

// Predict.fun 가격표 가져오기 (시간 조절 기능 포함)
async function getPredBook(marketId) {
    const now = Date.now();
    const wait = Math.max(0, PRED_MIN_GAP_MS - (now - lastPredCallAt));
    if (wait) await sleep(wait); // 필요하면 기다립니다.

    lastPredCallAt = Date.now();
    const url = `https://api.predict.fun/v1/markets/${marketId}/orderbook`;
    return fetchJson(url, { headers: { "x-api-key": PRED_KEY } });
}

// Predict.fun 가격 정리하기
function bestPxPred(book) {
    const b = book?.data;
    if (!b || !Array.isArray(b.bids) || !Array.isArray(b.asks)) {
        return { yesBid: null, yesAsk: null, noBid: null, noAsk: null };
    }
    const yesBid = b.bids[0]?.[0] != null ? Number(b.bids[0][0]) : null;
    const yesAsk = b.asks[0]?.[0] != null ? Number(b.asks[0][0]) : null;

    // 여기는 YES, NO 가격을 다 주네요.
    return {
        yesBid,
        yesAsk,
        noBid: yesBid != null ? 1 - yesBid : null, // (NO 가격이 없으면 1 - YES로 추정)
        noAsk: yesAsk != null ? 1 - yesAsk : null
    };
}

// 알림이 너무 자주 오면 시끄러우니까 조절합니다 (쿨타임 체크)
const lastAlertAt = new Map();
const canAlert = (key) => (Date.now() - (lastAlertAt.get(key) || 0)) >= COOLDOWN_MS;
const markAlert = (key) => lastAlertAt.set(key, Date.now());

// ---------------------------------------------------------
// 5. [메인 실행] 여기가 진짜 시작입니다!
// ---------------------------------------------------------
async function runOnce() {
    log(`\n[${new Date().toLocaleTimeString()}] 스캔 시작...`);

    // 1단계: 양쪽 사이트에서 마켓 정보를 싹 긁어옵니다.
    const [poly, pred] = await Promise.all([getPolyMarkets(), getPredMarkets()]);
    log(`  📊 수집 완료(유효): Poly(${poly.length}개) / Pred(${pred.length}개)`);

    // (확인용) 상위 3개만 로그에 찍어봅니다. 잘 가져왔나 보려구요.
    const short = (s) => (s && s.length > 10) ? s.slice(0, 6) + "..." : s;
    log("\n  [Poly 상위 3개 (Volume순)]");
    poly.slice(0, 3).forEach((m, i) => log(`    ${i + 1}. [Vol:${m.volume}] ${m.question} (ID: ${short(m.yes)}/${short(m.no)})`));

    // [롤백] 거래량 정보가 없으므로 다시 원래대로 출력
    log("\n  [Pred 상위 3개 (최신순 - Volume 미제공)]");
    pred.slice(0, 3).forEach((m, i) => log(`    ${i + 1}. ${m.question} (ID: ${m.id})`));

    // 2단계: 서로 비슷한 마켓이 있는지 '짝꿍'을 찾아봅니다.
    const matches = [];
    log("  🤝 유사도 매칭 분석 중...");

    for (const pm of poly) {
        let bestMatch = null;
        let maxScore = 0;

        for (const qm of pred) {
            // 두 제목이 얼마나 비슷한지 점수 계산!
            const score = calcJaccard(pm.question, qm.question);

            // 제일 점수 높은 짝을 기억해둡니다.
            if (score > maxScore) {
                maxScore = score;
                bestMatch = qm;
            }
        }

        // 점수가 합격점(0.35점)을 넘으면 "찾았다!" 하고 저장합니다.
        if (bestMatch && maxScore >= MATCH_THRESHOLD) {
            matches.push({ pm, qm: bestMatch, score: maxScore });
            log(`     🔗 [유사도 ${(maxScore * 100).toFixed(0)}%] 매칭 발견`);
            log(`        Poly: "${pm.question}"`);
            log(`        Pred: "${bestMatch.question}"`);
        }
    }

    if (matches.length === 0) {
        log("  ❌ 매칭된 질문이 없습니다. (다음 스캔을 기다리세요)");
        return;
    }

    // 3단계: 가격 비교해서 돈이 되는지 계산해봅니다.
    log(`  ✅ 총 ${matches.length}쌍 매칭됨! 가격 비교 상세 진입...`);

    // 너무 많이 하면 느려지니까 정해진 개수만큼만 확인합니다.
    const work = matches.slice(0, MAX_MATCHES_PER_LOOP);

    for (const { pm, qm } of work) {
        const alertKey = sha(pm.question); // 알림 키 생성
        log(`    👉 [검사 중] ${pm.question.slice(0, 30)}...`);

        // 양쪽 사이트의 가격표를 가져옵니다.
        const [py, pn, ob] = await Promise.all([
            getPolyBook(pm.yes), // Poly YES 가격표
            getPolyBook(pm.no),  // Poly NO 가격표
            getPredBook(qm.id)   // Pred 통합 가격표
        ]);

        // 가격표가 없으면 계산을 못하니 건너뜁니다.
        if (!py) log(`       ❌ 실패: Poly YES 오더북 없음 (ID: ${pm.yes})`);
        if (!pn) log(`       ❌ 실패: Poly NO 오더북 없음 (ID: ${pm.no})`);
        if (!ob) log(`       ❌ 실패: Pred 오더북 없음 (ID: ${qm.id})`);

        if (!py || !pn || !ob) {
            log("       💨 데이터 부족으로 건너뜁니다.");
            continue;
        }

        // 제일 좋은 가격만 쏙 뽑아냅니다.
        const polyYes = bestPxPoly(py);
        const polyNo = bestPxPoly(pn);
        const predPx = bestPxPred(ob);

        // 가격을 눈으로 확인하기 위해 로그 출력
        log(`       💰 P_YES(${polyYes.bestAsk}) P_NO(${polyNo.bestAsk}) / Pred_YES(${predPx.yesAsk}) Pred_NO(${predPx.noAsk})`);

        // -----------------------------------------------------
        // [수익률 계산 공식 - 초간단 설명]
        // 1. 우리는 '양쪽 다 당첨될 수 있게' 양방향으로 베팅합니다.
        // 2. A사이트에서 YES 사고, B사이트에서 NO를 삽니다.
        // 3. 그럼 결과가 뭐든 간에 둘 중 하나는 무조건 당첨돼서 1달러를 받습니다.
        // 4. 만약 두 개를 합쳐서 산 비용이 0.98달러라면?
        //    ==> 0.98달러 내고 1달러 받음 = 0.02달러(2%) 공짜 이득! (이게 아비트라지입니다)
        // -----------------------------------------------------

        // 전략 A: Poly에서 YES 사고 + Pred에서 NO 사기
        if (polyYes.bestAsk != null && predPx.noAsk != null) {
            const cost = polyYes.bestAsk + predPx.noAsk; // 총 비용
            const roi = (1 - cost) / cost; // 수익률 계산
            log(`       📉 수익률(A): ${(roi * 100).toFixed(2)}% (비용: ${cost.toFixed(3)})`);

            // 목표 수익률(ROI_THRESHOLD) 넘으면 텔레그램 알림!
            if (roi >= ROI_THRESHOLD && canAlert(alertKey)) {
                markAlert(alertKey);
                await tgSend(`[꿀통 발견 A] 🍯\n수익: ${(roi * 100).toFixed(2)}%\n비용: ${cost.toFixed(3)}\nPoly: ${pm.question}\nPred: ${qm.question}`);
            }
        }

        // 전략 B: Pred에서 YES 사고 + Poly에서 NO 사기
        if (predPx.yesAsk != null && polyNo.bestAsk != null) {
            const cost = predPx.yesAsk + polyNo.bestAsk;
            const roi = (1 - cost) / cost;
            log(`       📉 수익률(B): ${(roi * 100).toFixed(2)}% (비용: ${cost.toFixed(3)})`);

            // 목표 수익률 넘으면 텔레그램 알림!
            if (roi >= ROI_THRESHOLD && canAlert(alertKey)) {
                markAlert(alertKey);
                await tgSend(`[꿀통 발견 B] 🍯\n수익: ${(roi * 100).toFixed(2)}%\n비용: ${cost.toFixed(3)}\nPoly: ${pm.question}\nPred: ${qm.question}`);
            }
        }
    }

    // 메모리 청소 (오래된 알림 기록 지우기)
    if (lastAlertAt.size > 5000) lastAlertAt.clear();
}

// [봇 실행 시작점]
// 여기서부터 코드가 시작됩니다.
(async () => {
    log("=== 아비트라지 봇 (최종 수정 버전 v2) 가동 ===");
    while (true) { // 무한 반복
        try { await runOnce(); } // 한 번 실행하고
        catch (e) { console.error("에러 발생:", e.message); }
        await sleep(LOOP_MS); // 설정된 시간만큼 쉬었다가 다시 실행
    }
})();
