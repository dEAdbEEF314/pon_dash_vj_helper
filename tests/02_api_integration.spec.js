const { test, expect } = require('@playwright/test');

test.describe('Integration Test: Backend API Endpoints', () => {
    const host = 'http://172.19.0.2';

    test('GET config.php returns Pusher key configuration', async ({ request }) => {
        const response = await request.get(`${host}/backend/api/config.php`);
        expect(response.status()).toBe(200);
        const json = await response.json();
        expect(json).toHaveProperty('PUSHER_APP_KEY');
        expect(json).toHaveProperty('PUSHER_CLUSTER');
    });

    test('POST register.php creates a new session', async ({ request }) => {
        const payload = {
            accountName: "TestAccountSet",
            djPassword: "1234",
            vjPassword: "5678",
            tracks: [
                { artist: "Artist 1", title: "Title 1" },
                { artist: "Artist 2", title: "Title 2" }
            ]
        };
        const response = await request.post(`${host}/backend/api/register.php`, {
            data: payload
        });
        expect(response.status()).toBe(200);
        const json = await response.json();
        expect(json.success).toBe(true);
        expect(json.sessionId).toBeTruthy();
    });

    test('POST action.php handles SEND, VIBES, and READY actions', async ({ request }) => {
        // Register session first
        const regRes = await request.post(`${host}/backend/api/register.php`, {
            data: {
                accountName: "ActionSessionSet",
                djPassword: "9999",
                vjPassword: "8888",
                tracks: [{ artist: "A1", title: "T1" }, { artist: "A2", title: "T2" }]
            }
        });
        const regData = await regRes.json();
        expect(regData.success).toBe(true);
        const sessionId = regData.sessionId;

        // Login as DJ to get token
        const loginRes = await request.post(`${host}/backend/api/action.php?action=login&role=dj`, {
            data: { sessionId, password: "9999" }
        });
        const loginData = await loginRes.json();
        expect(loginData.success).toBe(true);
        const token = loginData.token;

        // 1. Send Track
        const sendRes = await request.post(`${host}/backend/api/action.php?action=send&role=dj`, {
            data: { sessionId, token, sendIdx: 0 }
        });
        expect(sendRes.status()).toBe(200);
        const sendJson = await sendRes.json();
        expect(sendJson.success).toBe(true);

        // 2. Vibes Track
        const vibesRes = await request.post(`${host}/backend/api/action.php?action=send&role=dj`, {
            data: { sessionId, token, customTrack: { title: "Vibes Song", artist: "Vibes Artist", isVibes: true } }
        });
        expect(vibesRes.status()).toBe(200);
        const vibesJson = await vibesRes.json();
        expect(vibesJson.success).toBe(true);

        // 3. VJ Ready
        const vjLoginRes = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId, password: "8888" }
        });
        const vjData = await vjLoginRes.json();
        expect(vjData.success).toBe(true);
        const vjToken = vjData.token;

        const readyRes = await request.post(`${host}/backend/api/action.php?action=ready&role=vj`, {
            data: { sessionId, token: vjToken }
        });
        expect(readyRes.status()).toBe(200);
        const readyJson = await readyRes.json();
        expect(readyJson.success).toBe(true);
    });
});
