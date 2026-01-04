import { CONFIG } from "./config.mjs";
import { fetchJson, logError } from "./utils.mjs";

export const TelegramService = {
    /**
     * 텔레그램으로 메시지를 전송하는 함수입니다.
     * @param {string} text - 보낼 메시지 내용
     */
    async send(text) {
        // 설정 파일에 토큰이나 채팅 ID가 없으면 경고하고 취소합니다.
        if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
            console.warn("Telegram 설정이 비어있어 메시지를 보낼 수 없습니다.");
            return;
        }

        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
        try {
            await fetchJson(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    chat_id: CONFIG.TELEGRAM_CHAT_ID,
                    text: text.length > 4000 ? text.substring(0, 4000) + "..." : text,
                    // 마크다운 파싱을 꺼서 특수문자 에러(HTTP 400)를 방지합니다.
                    // parse_mode: "Markdown",
                    disable_web_page_preview: true
                }),
            });
        } catch (e) {
            logError("텔레그램 전송 실패", e);
        }
    }
};
