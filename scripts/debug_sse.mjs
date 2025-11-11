import EventSource from 'eventsource';
import ApiClient from '../shared/apiClient.js';

const BASE_URL = 'http://127.0.0.1:5000';

async function main() {
    try {
        const api = new ApiClient(BASE_URL);
        const login = await api.login('patient');
        console.log('[debug] login result:', login);

        await new Promise((resolve, reject) => {
            const esUrl = `${BASE_URL}/events/${login.userId}`;
            console.log('[debug] connecting to', esUrl);
            const es = new EventSource(esUrl);

            es.onmessage = (event) => {
                console.log('[debug] SSE message:', event.data);
            };

            es.onerror = (err) => {
                console.error('[debug] SSE error:', err);
                es.close();
                reject(err);
            };

            setTimeout(async () => {
                try {
                    await api.sendMessage(
                        login.userId,
                        login.activeCircleId,
                        'CLI debug message: lots of sweating and shortness of breath.'
                    );
                    console.log('[debug] message sent');
                } catch (sendErr) {
                    console.error('[debug] send error:', sendErr);
                    es.close();
                    reject(sendErr);
                }
            }, 1000);

            setTimeout(() => {
                console.log('[debug] closing SSE stream');
                es.close();
                resolve();
            }, 7000);
        });

        console.log('[debug] test complete');
    } catch (error) {
        console.error('[debug] script error:', error);
        process.exit(1);
    }
}

main();

