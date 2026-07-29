/**
 * プレイリストファイルパーサー
 * 対応形式: M3U/M3U8, CSV, XML(Rekordbox), TXT
 */

class PlaylistParser {
    static async parse(file) {
        const text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        
        let tracks = [];
        
        try {
            if (ext === 'm3u' || ext === 'm3u8') {
                tracks = this.parseM3U(text);
            } else if (ext === 'csv') {
                tracks = this.parseCSV(text);
            } else if (ext === 'xml') {
                tracks = this.parseXML(text);
            } else if (ext === 'txt') {
                tracks = this.parseTXT(text);
            } else {
                throw new Error("非対応のファイル形式です");
            }
        } catch (e) {
            console.error("Parse error:", e);
            throw new Error("ファイルの解析に失敗しました: " + e.message);
        }

        if (tracks.length === 0) {
            throw new Error("曲情報が一つも見つかりませんでした");
        }

        return tracks;
    }

    static parseM3U(text) {
        const lines = text.split(/\r?\n/);
        const tracks = [];
        
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('#EXTINF:')) {
                // #EXTINF:秒数, アーティスト名 - 曲名  などのフォーマットを想定
                const info = line.substring(8);
                const commaIdx = info.indexOf(',');
                if (commaIdx !== -1) {
                    const trackStr = info.substring(commaIdx + 1).trim();
                    const parts = trackStr.split(' - ');
                    if (parts.length >= 2) {
                        tracks.push({
                            artist: parts[0].trim(),
                            title: parts.slice(1).join(' - ').trim()
                        });
                    } else {
                        tracks.push({
                            artist: "Unknown",
                            title: trackStr
                        });
                    }
                }
            } else if (line.length > 0 && !line.startsWith('#')) {
                // ファイルパスだけの行からファイル名を推測するフォールバック
                // 既にEXTINFで追加済みの場合はスキップ (簡単な判定として)
                // 今回はEXTINF優先とする
            }
        }
        return tracks;
    }

    static parseCSV(text) {
        const lines = text.split(/\r?\n/);
        const tracks = [];
        if(lines.length < 2) return tracks;

        // 簡単なCSVパーサー (クオート考慮)
        const parseLine = (str) => {
            const result = [];
            let current = '';
            let inQuote = false;
            for (let i = 0; i < str.length; i++) {
                if (str[i] === '"') {
                    inQuote = !inQuote;
                } else if (str[i] === ',' && !inQuote) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += str[i];
                }
            }
            result.push(current.trim());
            return result;
        };

        const headers = parseLine(lines[0].toLowerCase());
        const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('name') || h === '曲名');
        const artistIdx = headers.findIndex(h => h.includes('artist') || h === 'アーティスト');

        if (titleIdx === -1) throw new Error("CSVにタイトル/曲名列が見つかりません");

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const cols = parseLine(lines[i]);
            if (cols.length > titleIdx && cols[titleIdx]) {
                tracks.push({
                    title: cols[titleIdx].replace(/^"|"$/g, ''),
                    artist: artistIdx !== -1 && cols.length > artistIdx ? cols[artistIdx].replace(/^"|"$/g, '') : 'Unknown'
                });
            }
        }
        return tracks;
    }

    static parseXML(text) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        const tracks = [];
        
        // Rekordbox format: <TRACK Name="..." Artist="..." />
        const trackNodes = xmlDoc.getElementsByTagName("TRACK");
        for (let i = 0; i < trackNodes.length; i++) {
            const node = trackNodes[i];
            const title = node.getAttribute("Name") || node.getAttribute("Title");
            if (title) {
                tracks.push({
                    title: title,
                    artist: node.getAttribute("Artist") || 'Unknown'
                });
            }
        }
        return tracks;
    }

    static parseTXT(text) {
        const lines = text.split(/\r?\n/);
        const tracks = [];
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            // "アーティスト - 曲名" または "曲名" を推測
            const parts = line.split(/ - | \/ |\|/);
            if (parts.length >= 2) {
                tracks.push({
                    artist: parts[0].trim(),
                    title: parts.slice(1).join(' - ').trim()
                });
            } else {
                tracks.push({
                    title: line,
                    artist: 'Unknown'
                });
            }
        }
        return tracks;
    }
}
