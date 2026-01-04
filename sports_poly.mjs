
import { CONFIG } from "./config.mjs";
import { sleep, log, logError, fetchJson, loadState, saveState } from "./utils.mjs";
import { GeminiService } from "./gemini_service.mjs";
import { TelegramService } from "./telegram_service.mjs";


process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at:', p, 'reason:', reason);
    process.exit(1);
});


const MIN_VOLUME_NBA = 100000;
const MIN_VOLUME_NFL = 20000;
const MAX_VOLUME = 1000000; // 1M USD limit (User request to exclude M unit markets)
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Analyzed markets memory
const analyzedMarkets = new Set();
let isFirstRun = true;

const EVENTS_API_URL_NBA = "https://gamma-api.polymarket.com/events?closed=false&tag_slug=nba&limit=50&order=volume&ascending=false";
const EVENTS_API_URL_NFL = "https://gamma-api.polymarket.com/events?closed=false&tag_slug=nfl&limit=50&order=volume&ascending=false";


async function fetchEvents(url, sportName, minVolume) {
    try {
        const events = await fetchJson(url);
        if (!events || !Array.isArray(events)) {
            logError(`Polymarket API returned invalid data for ${sportName}`);
            return [];
        }

        const validMarkets = [];

        for (const event of events) {
            const eventVol = Number(event.volume) || 0;
            // Filter by event volume if needed, but we focus on market volume mostly
            // However, to save processing, we can skip very low volume events
            // But let's check market volume specifically as requested

            if (!event.markets || event.markets.length === 0) continue;

            // Sort markets within the event by volume (descending) to find the main one
            const sorted = event.markets.sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0));
            const mainMarket = sorted[0];

            const marketVol = Number(mainMarket.volume) || 0;

            // Check Limits
            if (marketVol < minVolume) continue;
            if (marketVol >= MAX_VOLUME) {
                log(`Debug: [${sportName}] Skipped '${mainMarket.question}' (Vol $${marketVol.toLocaleString()} >= $1M - excluded per user request)`);
                continue;
            }

            log(`Debug: [${sportName}] Event '${event.title}' (Mkt Vol $${marketVol}) -> TopMarket: '${mainMarket.question}'`);

            // Filter out non-match markets (must contain " vs " or " vs. ")
            if (!/ vs\.? /i.test(mainMarket.question)) {
                log(`Debug: Filtered out '${mainMarket.question}' (No ' vs ' match)`);
                continue;
            }

            log(`Debug: Accepted '${mainMarket.question}'`);

            // Attach event metadata for Gemini
            mainMarket.categorySlug = sportName.toLowerCase();
            mainMarket.sport = sportName;
            mainMarket.eventTitle = event.title;

            validMarkets.push(mainMarket);
        }

        return validMarkets;

    } catch (e) {
        logError(`Failed to fetch Polymarket events for ${sportName}`, e);
        return [];
    }
}

/**
 * Fetch top NBA & NFL events from Polymarket
 */
async function fetchPolyMarkets() {
    const [nba, nfl] = await Promise.all([
        fetchEvents(EVENTS_API_URL_NBA, "NBA", MIN_VOLUME_NBA),
        fetchEvents(EVENTS_API_URL_NFL, "NFL", MIN_VOLUME_NFL)
    ]);
    return [...nba, ...nfl];
}

async function runLoop() {

    log("🏀🏈 Polymarket Sports Bot Loop Start...");

    try {
        const markets = await fetchPolyMarkets();

        log(`Fetched ${markets.length} qualifying markets (NBA > $${MIN_VOLUME_NBA.toLocaleString()}, NFL > $${MIN_VOLUME_NFL.toLocaleString()}).`);

        if (markets.length > 0) {
            log("--- [Detected Markets Check] ---");
            markets.forEach((m, i) => {
                log(`${i + 1}. ${m.question} ($${Math.round(m.volume).toLocaleString()})`);
            });
            log("--------------------------------");
        }

        const newMarkets = [];
        for (const m of markets) {
            if (!analyzedMarkets.has(m.id)) {
                newMarkets.push(m);
            }
        }

        if (newMarkets.length > 0) {
            if (isFirstRun) {
                log(`First run: Found ${newMarkets.length} markets. processing...`);
            } else {
                log(`🆕 Found ${newMarkets.length} NEW markets!`);
            }

            for (const market of newMarkets) {
                const analyzed = await processMarket(market);
                if (analyzed) {
                    analyzedMarkets.add(market.id);
                }
                // Sleep to be gentle on Gemini API
                await sleep(20000);
            }

        } else {
            log(isFirstRun ? "No new markets to analyze." : "No new markets.");
        }

        isFirstRun = false;

    } catch (e) {
        logError("Error in runLoop", e);
    }
}

async function processMarket(market) {
    log(`Checking: ${market.question} (Vol: $${Math.round(market.volume || 0).toLocaleString()})`);

    try {
        // Prepare Polymarket Odds String
        let polyStr = "Info N/A";
        try {
            const outcomes = JSON.parse(market.outcomes);
            const prices = JSON.parse(market.outcomePrices);

            if (outcomes.length === 2 && prices.length === 2) {
                const p1 = (Number(prices[0]) * 100).toFixed(0);
                const p2 = (Number(prices[1]) * 100).toFixed(0);
                polyStr = `${outcomes[0]} ${p1}% / ${outcomes[1]} ${p2}%`;
            } else if (outcomes.length > 0) {
                // For multi-outcome, just show the top 2-3? or just the first one?
                // Let's safe-guard for now using the simple logic
                polyStr = outcomes.map((o, i) => `${o} ${(Number(prices[i]) * 100).toFixed(0)}%`).slice(0, 3).join(" / ");
            }
        } catch (e) {
            polyStr = "Parse Error";
        }

        // Gemini Analysis
        const aiPred = await GeminiService.analyzeMatch(market);


        if (aiPred) {
            const sportTag = `[${market.sport}]`; // [NBA] or [NFL]
            const volStr = `$${Math.round(market.volume || 0).toLocaleString()}`;

            // Format AI prediction line
            const aiLine = `${aiPred.teamA} ${aiPred.probA.toFixed(0)}% / ${aiPred.teamB} ${aiPred.probB.toFixed(0)}%`;


            const message = `
[🧿POLYMARKET]
${sportTag} ${market.question} [vol : ${volStr}]
POLYMARKET : ${polyStr}
GEMINI     : ${aiLine}

💡 [ Analysis ]
${aiPred.reasoning}

⚠️ [ Risks ]

${aiPred.risks}
`;
            log(`Sending alert for ${market.question}`);
            log("--- Message Content Check ---");
            log(message);
            log("-----------------------------");
            await TelegramService.send(message);
            return true;
        } else {
            log(`Skipping: Gemini analysis failed for ${market.question}`);
            return false;
        }

    } catch (e) {
        logError(`Failed to process ${market.id}`, e);
        return false;
    }
}

// Entry Point
// 메인 실행 로직을 함수로 분리 및 export
export async function run() {
    log("=== Polymarket Sports Bot (NBA + NFL) Started (GitHub Actions Mode) ===");

    // 0. 이전 상태(이미 분석한 마켓 목록)를 불러옵니다.
    const STATE_FILE = "analyzed_markets.json";
    const state = await loadState(STATE_FILE);

    // analyzedMarkets Set을 복구합니다.
    if (state.polymarket && Array.isArray(state.polymarket)) {
        state.polymarket.forEach(id => analyzedMarkets.add(id));
        log(`Loaded ${analyzedMarkets.size} analyzed markets from history.`);
    }

    // 1. Initial Run (Once)
    await runLoop();

    // 2. 현재 상태를 저장합니다.
    state.polymarket = Array.from(analyzedMarkets);
    await saveState(STATE_FILE, state);
    log(`Saved analysis state. (Total ${analyzedMarkets.size} markets)`);

    log("=== Bot Finished ===");
}

// 직접 실행되었을 때만 run() 실행
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run().catch(e => {
        console.error("FATAL ERROR:", e);
        process.exit(1);
    });
}
