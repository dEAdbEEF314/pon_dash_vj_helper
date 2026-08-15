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
            data: { sessionId, token: vjToken, readyForVersion: vibesJson.stateVersion }
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
            data: { lobbyCode: lobbyData.lobbyCode, knownSessionIds: [], knownTokenHashes: {} }
        });
        const pollData = await pollRes.json();
        expect(pollData.success).toBe(true);
        expect(pollData.added[0]).not.toHaveProperty('vjUrl');
        expect(pollData.added[0].inviteToken).toBeTruthy();

        const inviteLoginRes = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId: regData.sessionId, inviteToken: pollData.added[0].inviteToken }
        });
        const inviteLoginData = await inviteLoginRes.json();
        expect(inviteLoginData.success).toBe(true);

        const replayRes = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId: regData.sessionId, inviteToken: pollData.added[0].inviteToken }
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

    test('one VJ can manage three DJ sessions with independent real playlists, SEND, deletion, and recovery', async ({ request }) => {
        const fs = require('fs');
        const path = require('path');
        const playlists = [
            { name: 'DJ_ALPHA', file: '20250224_playlist_1.m3u8', password: '3101' },
            { name: 'DJ_BETA', file: '20260131_playlist_2.m3u8', password: '3102' },
            { name: 'DJ_GAMMA', file: '20260514_playlist_3.m3u8', password: '3103' }
        ];
        const parseM3U8 = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8')
            .split(/\r?\n/)
            .filter(line => line.startsWith('#EXTINF:'))
            .map(line => {
                const text = line.slice(line.indexOf(',') + 1).trim();
                const [artist, ...title] = text.split(' - ');
                return { artist: artist.trim(), title: title.join(' - ').trim() || artist.trim() };
            });

        const lobby = await (await request.post(`${host}/backend/api/action.php?action=create_lobby`, { data: {} })).json();
        expect(lobby.success).toBe(true);

        const sessions = [];
        for (const playlist of playlists) {
            const tracks = parseM3U8(playlist.file);
            expect(tracks.length).toBeGreaterThan(0);
            const registration = await request.post(`${host}/backend/api/register.php`, {
                data: {
                    accountName: playlist.name,
                    djPassword: playlist.password,
                    vjPassword: '3199',
                    tracks
                }
            });
            const registrationData = await registration.json();
            expect(registrationData.success).toBe(true);

            const push = await request.post(`${host}/backend/api/action.php?action=push_to_lobby`, {
                data: {
                    lobbyCode: lobby.lobbyCode,
                    sessionId: registrationData.sessionId,
                    vjPassword: '3199',
                    djName: playlist.name
                }
            });
            expect((await push.json()).success).toBe(true);
            sessions.push({ ...playlist, sessionId: registrationData.sessionId, tracks });
        }

        const initialPoll = await (await request.post(`${host}/backend/api/action.php?action=poll_lobby`, {
            data: { lobbyCode: lobby.lobbyCode, knownSessionIds: [], knownTokenHashes: {} }
        })).json();
        expect(initialPoll.success).toBe(true);
        expect(initialPoll.added).toHaveLength(3);

        const vjTokens = {};
        for (const added of initialPoll.added) {
            const login = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
                data: { sessionId: added.sessionId, inviteToken: added.inviteToken }
            });
            const data = await login.json();
            expect(data.success).toBe(true);
            expect(data.state.tracks[0]).toEqual(sessions.find(s => s.sessionId === added.sessionId).tracks[0]);
            vjTokens[added.sessionId] = data.token;
        }

        const djTokens = {};
        for (const session of sessions) {
            const login = await request.post(`${host}/backend/api/action.php?action=login&role=dj`, {
                data: { sessionId: session.sessionId, password: session.password }
            });
            const data = await login.json();
            expect(data.success).toBe(true);
            djTokens[session.sessionId] = data.token;
        }

        for (const [index, session] of sessions.entries()) {
            const send = await request.post(`${host}/backend/api/action.php?action=send&role=dj`, {
                data: { sessionId: session.sessionId, token: djTokens[session.sessionId], sendIdx: index }
            });
            const data = await send.json();
            expect(data.success).toBe(true);
            expect(data.sentIdx).toBe(index);
            expect(data.stateVersion).toBe(1);
        }

        const beta = sessions[1];
        const deleteBeta = await request.post(`${host}/backend/api/action.php?action=delete_session&role=vj`, {
            data: { sessionId: beta.sessionId, token: vjTokens[beta.sessionId] }
        });
        expect((await deleteBeta.json()).success).toBe(true);

        const afterRemoval = await (await request.post(`${host}/backend/api/action.php?action=poll_lobby`, {
            data: {
                lobbyCode: lobby.lobbyCode,
                knownSessionIds: sessions.map(s => s.sessionId),
                knownTokenHashes: Object.fromEntries(initialPoll.added.map(item => [item.sessionId, item.inviteTokenHash]))
            }
        })).json();
        expect(afterRemoval.success).toBe(true);
        expect(afterRemoval.removedSessionIds).toEqual([beta.sessionId]);

        const deletedSend = await request.post(`${host}/backend/api/action.php?action=send&role=dj`, {
            data: { sessionId: beta.sessionId, token: djTokens[beta.sessionId], sendIdx: 0 }
        });
        expect((await deletedSend.json()).success).toBe(false);

        for (const session of [sessions[0], sessions[2]]) {
            const recoveryLogin = await request.post(`${host}/backend/api/action.php?action=login&role=dj`, {
                data: { sessionId: session.sessionId, password: session.password }
            });
            const recovery = await recoveryLogin.json();
            expect(recovery.success).toBe(true);
            expect(recovery.state.tracks[0]).toEqual(session.tracks[0]);
            const recoveredSend = await request.post(`${host}/backend/api/action.php?action=send&role=dj`, {
                data: { sessionId: session.sessionId, token: recovery.token, sendIdx: 0 }
            });
            expect((await recoveredSend.json()).success).toBe(true);
        }

        const vjRecovery = await request.post(`${host}/backend/api/action.php?action=login&role=vj`, {
            data: { sessionId: sessions[0].sessionId, password: '3199' }
        });
        expect((await vjRecovery.json()).success).toBe(true);
    });
});
