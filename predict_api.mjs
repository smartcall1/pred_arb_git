import { CONFIG } from "./config.mjs";
import { fetchJson, log } from "./utils.mjs";

export const PredictApi = {
    /**
     * Predict.fun 사이트에서 현재 열려있는 마켓들을 가져오고, 그 중에서 스포츠 경기만 골라냅니다.
     * 참고: API가 종목별 필터링을 지원하지 않아서, 저희가 직접 이름을 보고 스포츠인지 판단해야 합니다.
     */
    async fetchSportsMarkets() {
        if (!CONFIG.PREDICT_FUN_API_KEY) {
            throw new Error("Missing PREDICT_FUN_API_KEY");
        }

        const markets = [];
        let cursor = null; // 다음 페이지를 가져오기 위한 위치 표시
        let keepGoing = true;

        // 너무 많이 가져오면 느려지니까 최근 5페이지까지만 확인합니다.
        const PAGE_LIMIT = 5;
        let pagesFetched = 0;

        while (keepGoing && pagesFetched < PAGE_LIMIT) {
            let url = `https://api.predict.fun/v1/markets?first=50`;
            if (cursor) url += `&after=${cursor}`;

            // API 호출
            const res = await fetchJson(url, {
                headers: { "x-api-key": CONFIG.PREDICT_FUN_API_KEY }
            });

            // 데이터가 없으면 중단
            if (!res || !res.data || res.data.length === 0) {
                break;
            }

            // 가져온 마켓들을 목록에 추가
            markets.push(...res.data);

            // 다음 페이지가 있는지 확인
            cursor = res.cursor;
            if (!cursor) keepGoing = false;
            pagesFetched++;
        }

        // 중복 제거: 가끔 같은 마켓이 ID만 다르게 여러 번 나올 때가 있어서, 제목을 기준으로 중복을 없앱니다.
        const uniqueMarketsMap = new Map();
        for (const m of markets) {
            const title = m.question || m.title;
            // 제목 앞뒤 공백 제거
            const key = title ? title.trim() : m.id;

            if (!uniqueMarketsMap.has(key)) {
                uniqueMarketsMap.set(key, m);
            }
        }
        const uniqueMarkets = Array.from(uniqueMarketsMap.values());

        // 스포츠 마켓만 남기기 (필터링)
        const sportsMarkets = uniqueMarkets.filter(m => {
            // 이미 끝난 마켓은 제외
            const isResolved = m.status === 'RESOLVED' || m.status === 'CLOSED';
            if (isResolved) return false;

            const title = (m.question || m.title || "").toLowerCase();

            // 스포츠 경기는 보통 "A vs B" 형식이므로 "vs"가 없으면 제외
            if (!title.includes(" vs ")) return false;

            // "vs"가 있지만 코인 가격 예측인 경우(예: BTC vs ETH)는 제외
            const cryptoKeywords = ["bitcoin", "btc", "ethereum", "eth", "solana", "price", "market cap"];
            if (cryptoKeywords.some(kw => title.includes(kw))) return false;

            return true;
        });

        // 사용하기 편한 형태로 정리해서 반환
        return sportsMarkets.map(m => PredictApi.normalizeMarket(m));
    },

    /**
     * 마켓 데이터를 우리가 쓰기 편한 표준 형식으로 변환합니다.
     */
    normalizeMarket(m) {
        return {
            id: m.id,
            question: m.question || m.title, // 질문(제목)
            categorySlug: m.categorySlug, // 카테고리 정보 (리그 식별용)
            description: m.description, // 상세 설명 (분석용)
            raw: m // 원본 데이터도 보관
        };
    },

    /**
     * 특정 마켓의 현재 배당률(Orderbook) 정보를 가져옵니다.
     * 여기서 Yes/No 확률을 알 수 있습니다.
     */
    async getMarketOdds(marketId) {
        const url = `https://api.predict.fun/v1/markets/${marketId}/orderbook`;
        const res = await fetchJson(url, {
            headers: { "x-api-key": CONFIG.PREDICT_FUN_API_KEY }
        });

        if (!res || !res.data) return null;

        const b = res.data;
        // 'asks'(매도 호가)의 첫 번째 가격을 현재 시세로 봅니다.
        const yesAsk = b.asks?.[0]?.[0] ? Number(b.asks[0][0]) : null;

        return {
            yesPrice: yesAsk,
            noPrice: yesAsk ? (1 - yesAsk) : null
        };
    },

    /**
     * 마켓의 통계 정보(거래량, 유동성 등)를 가져옵니다.
     * 엔드포인트: /v1/markets/{id}/stats
     */
    async getMarketStats(marketId) {
        const url = `https://api.predict.fun/v1/markets/${marketId}/stats`;
        try {
            const res = await fetchJson(url, {
                headers: { "x-api-key": CONFIG.PREDICT_FUN_API_KEY }
            });

            if (!res || !res.data) return null;

            return {
                volumeTotalUsd: res.data.volumeTotalUsd,
                volume24hUsd: res.data.volume24hUsd,
                totalLiquidityUsd: res.data.totalLiquidityUsd
            };
        } catch (e) {
            console.error(`Error fetching stats for market ${marketId}:`, e.message);
            return null;
        }
    }
};
