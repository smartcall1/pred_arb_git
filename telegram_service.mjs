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
                    text: text,
                    // 마크다운 문법(**굵게** 등)을 사용할 수 있게 설정합니다.
                    parse_mode: "Markdown",
                    // 링크 미리보기를 끕니다 (메시지가 너무 길어지는 것 방지)
                    disable_web_page_preview: true
                }),
            });
        } catch (e) {
            logError("텔레그램 전송 실패", e);
        }
    }
};
