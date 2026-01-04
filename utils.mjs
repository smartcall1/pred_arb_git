import { CONFIG } from "./config.mjs";

// 지정된 시간(밀리초)만큼 잠시 멈추는 함수
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 인터넷에서 데이터를 가져오는 함수 (재시도 기능 포함)
 * @param {string} url - 가져올 주소
 * @param {object} options - 설정 (헤더, 메소드 등)
 * @param {number} retries - 실패 시 재시도 횟수
 */
export async function fetchJson(url, options = {}, retries = CONFIG.RETRY_COUNT) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, options);

            // 성공 (200 OK) 했을 때
            if (res.ok) {
                const text = await res.text();
                // 내용이 있으면 JSON으로 변환해서 반환
                return text ? JSON.parse(text) : null;
            }

            // 404 (찾을 수 없음) 에러는 재시도해도 소용없으므로 바로 종료
            if (res.status === 404) {
                console.warn(`[HTTP 404] Resource not found: ${url}`);
                return null;
            }

            // 재시도할 만한 에러인지 확인 (429: 너무 많이 요청함, 500번대: 서버 오류)
            const isRetryable = [429, 500, 502, 503, 504].includes(res.status);

            // 재시도할 필요가 없거나, 재시도 횟수를 다 썼으면 에러 발생시킴
            if (!isRetryable || i === retries) {
                throw new Error(`HTTP ${res.status} ${url}`);
            }

            // 재시도 전 대기 시간 설정 (점점 길어짐)
            let delay = Math.min(5000, 500 * Math.pow(2, i));

            // 만약 429(Rate Limit) 에러라면 10초 동안 푹 쉽니다.
            if (res.status === 429) {
                console.warn(`[HTTP 429] 너무 많은 요청을 보냈습니다. 10초 대기...`);
                delay = 10000;
            }

            await sleep(delay);

        } catch (e) {
            console.error(`API 요청 실패 (${url}):`, e.message);
            // 마지막 시도였으면 에러를 밖으로 던짐
            if (i === retries) throw e;
            await sleep(1000);
        }
    }
}

// 현재 시간과 함께 로그를 출력하는 함수
export function log(message) {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// 에러 로그를 빨간색(일반적으로)으로 출력하는 함수
export function logError(message, error) {
    console.error(`[${new Date().toLocaleTimeString()}] [ERROR] ${message}`, error?.message || error);
}

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function loadState(filePath) {
    if (!existsSync(filePath)) {
        return { predict_fun: [], polymarket: [] };
    }
    try {
        const data = await readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        logError(`Failed to load state from ${filePath}`, e);
        return { predict_fun: [], polymarket: [] };
    }
}

export async function saveState(filePath, data) {
    try {
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        logError(`Failed to save state to ${filePath}`, e);
    }
}
