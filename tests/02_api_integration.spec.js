const { test, expect } = require('@playwright/test');

test.describe('Integration Test: Backend API Endpoints', () => {
    const host = 'http://172.19.0.2';

    test('GET config.php returns Pusher key configuration', async ({ request }) => {
        const response = await request.get(`${host}/backend/api/config.php`);
        expect(response.status()).toBe(200);
        expect(response.headers()['x-content-type-options']).toBe('nosniff');
        expect(response.headers()['referrer-policy']).toBe('no-referrer');
        expect(response.headers()['cache-control']).toBe('no-store');
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

    test('VJ lobby uses a single-use invite token instead of a password URL', async ({ request }) => {
        const regRes = await request.post(`${host}/backend/api/register.php`, {
            data: {
                accountName: 'InviteTokenSession',
                djPassword: '1357',
                vjPassword: '2468',
                tracks: [{ artist: 'Artist', title: 'Title' }]
            }
        });
        const regData = await regRes.json();
        expect(regData.success).toBe(true);

        const lobbyRes = await request.post(`${host}/backend/api/action.php?action=create_lobby`, { data: {} });
        const lobbyData = await lobbyRes.json();
        expect(lobbyData.success).toBe(true);
        expect(lobbyData.lobbyCode).toMatch(/^[A-Z0-9]{10}$/);

        const pushRes = await request.post(`${host}/backend/api/action.php?action=push_to_lobby`, {
            data: {
                lobbyCode: lobbyData.lobbyCode,
                sessionId: regData.sessionId,
                vjPassword: '2468',
                djName: 'InviteTokenSession'
            }
        });
        const pushData = await pushRes.json();
        expect(pushData.success).toBe(true);

        const pollRes = await request.post(`${host}/backend/api/action.php?action=poll_lobby`, {
            data: { lobbyCode: lobbyData.lobbyCode }
        });
        const pollData = await pollRes.json();
        expect(pollData.success).toBe(true);
        expect(pollData.sessions[0]).not.toHaveProperty('vjUrl');
        expect(pollData.sessions[0].inviteToken).toBeTruthy();

        const inviteLoginRes = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId: regData.sessionId, inviteToken: pollData.sessions[0].inviteToken }
        });
        const inviteLoginData = await inviteLoginRes.json();
        expect(inviteLoginData.success).toBe(true);

        const replayRes = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId: regData.sessionId, inviteToken: pollData.sessions[0].inviteToken }
        });
        const replayData = await replayRes.json();
        expect(replayData.success).toBe(false);
    });

    test('API rejects malformed session IDs and registration names', async ({ request }) => {
        const sessionRes = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId: '../env.php', password: '2468' }
        });
        expect((await sessionRes.json()).success).toBe(false);

        const registrationRes = await request.post(`${host}/backend/api/register.php`, {
            data: {
                accountName: '<script>alert(1)</script>',
                djPassword: '1357',
                vjPassword: '2468',
                tracks: [{ artist: 'Artist', title: 'Title' }]
            }
        });
        expect((await registrationRes.json()).success).toBe(false);
    });

    test('API rejects cross-origin registration requests', async ({ request }) => {
        const response = await request.post(`${host}/backend/api/register.php`, {
            headers: { Origin: 'https://attacker.example' },
            data: {
                accountName: 'CrossOriginTest',
                djPassword: '1357',
                vjPassword: '2468',
                tracks: [{ artist: 'Artist', title: 'Title' }]
            }
        });
        expect(response.status()).toBe(403);
        expect((await response.json()).success).toBe(false);

        const actionResponse = await request.post(`${host}/backend/api/action.php?action=create_lobby`, {
            headers: { Origin: 'https://attacker.example' },
            data: {}
        });
        expect(actionResponse.status()).toBe(403);
        expect((await actionResponse.json()).success).toBe(false);
    });

    test('authenticated delete_session removes the server session', async ({ request }) => {
        const registration = await request.post(`${host}/backend/api/register.php`, {
            data: {
                accountName: 'DeleteSessionTest',
                djPassword: '1357',
                vjPassword: '2468',
                tracks: [{ artist: 'Artist', title: 'Title' }]
            }
        });
        const { sessionId } = await registration.json();
        const login = await request.post(`${host}/backend/api/action.php?action=login&role=dj`, {
            data: { sessionId, password: '1357' }
        });
        const { token } = await login.json();

        const deletion = await request.post(`${host}/backend/api/action.php?action=delete_session&role=dj`, {
            data: { sessionId, token }
        });
        expect((await deletion.json()).success).toBe(true);

        const afterDeletion = await request.post(`${host}/backend/api/action.php?action=send&role=dj`, {
            data: { sessionId, token, sendIdx: 0 }
        });
        expect((await afterDeletion.json()).success).toBe(false);
    });
});
