import { run as runSportsBot } from './sports_bot.mjs';
import { run as runSportsPoly } from './sports_poly.mjs';
import { log, logError } from './utils.mjs';

(async () => {
    try {
        log("🚀 Starting Combined Sports Prediction Bot...");

        log("\n-------------------------------------------");
        log("▶️  Running Predict.fun Bot (sports_bot.mjs)");
        log("-------------------------------------------");
        await runSportsBot();

        log("\n-------------------------------------------");
        log("▶️  Running Polymarket Bot (sports_poly.mjs)");
        log("-------------------------------------------");
        await runSportsPoly();

        log("\n✅ All bots finished successfully.");
    } catch (e) {
        logError("FATAL ERROR in Main Loop", e);
        process.exit(1);
    }
})();
