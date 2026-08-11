const { test, expect } = require('@playwright/test');

test.describe('Unit Test: PlaylistParser (parser.js)', () => {
    const host = 'http://172.19.0.2';

    test('M3U/M3U8 parsing', async ({ page }) => {
        await page.goto(`${host}/index.html`);
        const result = await page.evaluate(() => {
            const m3uText = `#EXTM3U\n#EXTINF:215,Artist A - Title A\n#EXTINF:180,Artist B - Title B`;
            const file = new File([m3uText], "playlist.m3u8", { type: "text/plain" });
            return PlaylistParser.parse(file);
        });
        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ artist: 'Artist A', title: 'Title A' });
        expect(result[1]).toEqual({ artist: 'Artist B', title: 'Title B' });
    });

    test('CSV parsing', async ({ page }) => {
        await page.goto(`${host}/index.html`);
        const result = await page.evaluate(() => {
            const csvText = `Track Title,Artist Name\nSong One,Singer One\nSong Two,Singer Two`;
            const file = new File([csvText], "playlist.csv", { type: "text/csv" });
            return PlaylistParser.parse(file);
        });
        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ artist: 'Singer One', title: 'Song One' });
    });

    test('TXT parsing', async ({ page }) => {
        await page.goto(`${host}/index.html`);
        const result = await page.evaluate(() => {
            const txtText = `Artist X - Track X\nArtist Y - Track Y`;
            const file = new File([txtText], "playlist.txt", { type: "text/plain" });
            return PlaylistParser.parse(file);
        });
        expect(result.length).toBe(2);
        expect(result[0].artist).toBe('Artist X');
        expect(result[0].title).toBe('Track X');
    });

    test('XML parsing (Rekordbox format)', async ({ page }) => {
        await page.goto(`${host}/index.html`);
        const result = await page.evaluate(() => {
            const xmlText = `<?xml version="1.0" encoding="UTF-8"?>
            <DJ_PLAYLISTS Version="1.0.0">
                <COLLECTION Entries="2">
                    <TRACK Name="Rec Song 1" Artist="Rec Artist 1"/>
                    <TRACK Name="Rec Song 2" Artist="Rec Artist 2"/>
                </COLLECTION>
            </DJ_PLAYLISTS>`;
            const file = new File([xmlText], "rekordbox.xml", { type: "text/xml" });
            return PlaylistParser.parse(file);
        });
        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ artist: 'Rec Artist 1', title: 'Rec Song 1' });
    });
});
