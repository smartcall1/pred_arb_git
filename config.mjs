import "dotenv/config";

export const CONFIG = {
    // API Keys
    //change test
    PREDICT_FUN_API_KEY: process.env.PREDICT_FUN_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,

    // Settings
    LOOP_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes
    RETRY_COUNT: 3,
    MARKET_FETCH_LIMIT: 50, // Fetch 50 most recent to check for new ones
    MIN_VOLUME_USD: 10000, // 최소 거래량 ($10,000)

    // Thresholds or formatting
    PROBABILITY_DECIMALS: 1, // e.g. 68.5%
};

// Validation
const requiredKeys = [
    "PREDICT_FUN_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "GOOGLE_API_KEY"
];

for (const key of requiredKeys) {
    if (!CONFIG[key]) {
        console.warn(`[WARNING] Missing ${key} in .env file. The bot may not function correctly.`);
    }
}
