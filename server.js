const express = require('express');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue, update } = require('firebase/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ping', (req, res) => res.send('Bot is Alive & Working 24/7!'));

app.listen(PORT, () => {
    console.log(`✅ Web server is LIVE on port ${PORT}`);
    console.log(`🚀 MULTI-CHANNEL BACKGROUND ENGINE STARTED!`);
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const firebaseConfig = {
  apiKey: "AIzaSyDry23GcB5q3ok5Y1e-UjbGKtZ6e18rVjM",
  authDomain: "hbot-9c1ae.firebaseapp.com",
  databaseURL: "https://hbot-9c1ae-default-rtdb.firebaseio.com",
  projectId: "hbot-9c1ae",
  storageBucket: "hbot-9c1ae.firebasestorage.app",
  messagingSenderId: "308636179274",
  appId: "1:308636179274:web:d80041c66c6537f3d43fb3"
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);
const channelsRef = ref(db, 'channels');

let channelsData = {};
let channelActiveStates = {};
let sentSignalsLog = {}; 

onValue(channelsRef, (snapshot) => {
    channelsData = snapshot.val() || {};
    console.log(`🔄 Channels Synced! Total Channels in DB: ${Object.keys(channelsData).length}`);
});

const APIS = {
    '30S': 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json',
    '1M': 'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
    '3M': 'https://draw.ar-lottery01.com/WinGo/WinGo_3M/GetHistoryIssuePage.json',
    '5M': 'https://draw.ar-lottery01.com/WinGo/WinGo_5M/GetHistoryIssuePage.json'
};

const serverStates = {
    '30S': { p: null, pred: null, opposites: [], isFetching: false }, 
    '1M': { p: null, pred: null, opposites: [], isFetching: false },
    '3M': { p: null, pred: null, opposites: [], isFetching: false }, 
    '5M': { p: null, pred: null, opposites: [], isFetching: false }
};

// D4X Strict Logic V15
function calculateD4XPrediction(list) {
    const last5 = list.slice(0, 5);
    const last5Sizes = last5.map(x => parseInt(x.number) >= 5 ? "BIG" : "SMALL");
    
    const bigCount = last5Sizes.filter(size => size === "BIG").length;
    const smallCount = last5Sizes.filter(size => size === "SMALL").length;
    
    let prediction = "BIG";
    if (bigCount > smallCount) {
        prediction = "BIG";
    } else if (smallCount > bigCount) {
        prediction = "SMALL";
    }

    const B_POOL = [5, 6, 7, 8, 9];
    const S_POOL = [0, 1, 2, 3, 4];
    const oppositePool = prediction === "BIG" ? S_POOL : B_POOL;
    const opposites = [];
    
    while (opposites.length < 2) {
        const randomNum = oppositePool[Math.floor(Math.random() * oppositePool.length)];
        if (!opposites.includes(randomNum)) {
            opposites.push(randomNum);
        }
    }
    
    return { prediction, opposites };
}

function isServerNeeded(server) {
    for (let key in channelsData) {
        let c = channelsData[key];
        if (c.isActive && c.server === server) {
            return true;
        }
    }
    return false;
}

function isTimeAllowed(timesRaw) {
    if(!timesRaw) return true; 
    let timesArray = Array.isArray(timesRaw) ? timesRaw : Object.values(timesRaw);
    if(timesArray.length === 0) return true;

    let now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
    let currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    let hasValidBoxSet = false;

    for(let box of timesArray) {
        if(box && box.start && box.end) {
            hasValidBoxSet = true;
            let s = box.start.split(':');
            let e = box.end.split(':');
            let startMin = parseInt(s[0])*60 + parseInt(s[1]);
            let endMin = parseInt(e[0])*60 + parseInt(e[1]);
            
            if (startMin <= endMin) {
                if(currentMinutes >= startMin && currentMinutes <= endMin) return true;
            } else { 
                if(currentMinutes >= startMin || currentMinutes <= endMin) return true;
            }
        }
    }
    return !hasValidBoxSet;
}

async function tgMsg(token, chat, text) {
    if(!token || !chat || !text) return;
    try { 
        let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ chat_id: chat, text: text, parse_mode: 'HTML' })
        }); 
        let json = await res.json();
        if(!json.ok) {
            console.log(`⚠️ Telegram Warning [${chat}]:`, json.description);
        } else {
            console.log(`📩 Message sent to Telegram [${chat}]`);
        }
    } catch(e) {
        console.log(`❌ Telegram API Request Failed:`, e.message);
    }
}

async function tgSticker(token, chat, stickerId) {
    if(!token || !chat || !stickerId || stickerId.trim() === '') return;
    try { 
        await fetch(`https://api.telegram.org/bot${token}/sendSticker`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ chat_id: chat, sticker: stickerId.trim() })
        }); 
    } catch(e) {}
}

async function processPeriodChange(server, oldPeriod, actualNumber, actualSize, newPrediction, newOpposites, nextPeriodStr) {
    const channelTasks = [];

    for (let key in channelsData) {
        let c = channelsData[key];
        
        if (c.isActive && c.server === server && c.botToken && c.chatId) {
            
            if (c.lastSentPeriod === nextPeriodStr) {
                continue; 
            }

            let sentinelKey = `${c.chatId}_${nextPeriodStr}`;
            if (sentSignalsLog[sentinelKey]) {
                continue; 
            }
            sentSignalsLog[sentinelKey] = true;

            update(ref(db, `channels/${key}`), { lastSentPeriod: nextPeriodStr });

            console.log(`📡 Processing channel [${c.name}] for server ${server}...`);
            channelTasks.push((async () => {
                try {
                    if(!channelActiveStates[key]) {
                        channelActiveStates[key] = { 
                            martingaleActive: false, 
                            warningsSent: {},
                            lastSentPeriod: null, 
                            lastSentPred: null,
                            lastSentOpposites: []
                        };
                    }
                    let internalState = channelActiveStates[key];

                    let inTime = isTimeAllowed(c.times);
                    let hasUnresolvedSignal = (internalState.lastSentPeriod === oldPeriod);

                    if (!inTime && !internalState.martingaleActive && !hasUnresolvedSignal) {
                        return; 
                    }

                    let isWin = false;
                    let targetReached = false;
                    const numberStr = actualNumber.toString();
                    const sizeStr = actualSize;

                    if (hasUnresolvedSignal) {
                        // D4X Strict Win Check
                        const predMatched = (internalState.lastSentPred === actualSize);
                        const safetyMatched = (internalState.lastSentOpposites && internalState.lastSentOpposites.includes(actualNumber));
                        isWin = predMatched || safetyMatched;
                        
                        if (isWin) {
                            internalState.martingaleActive = false; 

                            if (c.stopOnWinTarget) {
                                let newWinCount = (c.currentWins || 0) + 1;
                                if (newWinCount >= c.targetWins) {
                                    c.isActive = false; 
                                    update(ref(db, 'channels/' + key), { isActive: false, currentWins: 0 });
                                    targetReached = true; 
                                } else {
                                    c.currentWins = newWinCount;
                                    update(ref(db, 'channels/' + key), { currentWins: newWinCount });
                                }
                            }

                            // CHECK JACKPOT (Safety matched while size missed)
                            if (safetyMatched) {
                                let jackMsg = (c.jackpotMsg || '🎯 JACKPOT WIN! Single Number {number} Matched! 🔥')
                                    .replace(/{number}/g, numberStr)
                                    .replace(/{size}/g, sizeStr);
                                await tgMsg(c.botToken, c.chatId, jackMsg);
                                await sleep(400);
                                if (c.jSticker1) { await tgSticker(c.botToken, c.chatId, c.jSticker1); await sleep(400); }
                                if (c.jSticker2) { await tgSticker(c.botToken, c.chatId, c.jSticker2); await sleep(400); }
                                if (c.jSticker3) { await tgSticker(c.botToken, c.chatId, c.jSticker3); }
                            } 
                            // NORMAL WIN
                            else {
                                if (actualSize === 'BIG') {
                                    let winMsg = (c.bigMsg || '✅ WIN (BIG)! Result Number: {number}')
                                        .replace(/{number}/g, numberStr)
                                        .replace(/{size}/g, sizeStr);
                                    if (winMsg) await tgMsg(c.botToken, c.chatId, winMsg);
                                    await sleep(400); 
                                    if (c.bSticker1) { await tgSticker(c.botToken, c.chatId, c.bSticker1); await sleep(400); }
                                    if (c.bSticker2) { await tgSticker(c.botToken, c.chatId, c.bSticker2); await sleep(400); }
                                    if (c.bSticker3) { await tgSticker(c.botToken, c.chatId, c.bSticker3); }
                                } else {
                                    let winMsg = (c.smallMsg || '✅ WIN (SMALL)! Result Number: {number}')
                                        .replace(/{number}/g, numberStr)
                                        .replace(/{size}/g, sizeStr);
                                    if (winMsg) await tgMsg(c.botToken, c.chatId, winMsg);
                                    await sleep(400);
                                    if (c.sSticker1) { await tgSticker(c.botToken, c.chatId, c.sSticker1); await sleep(400); }
                                    if (c.sSticker2) { await tgSticker(c.botToken, c.chatId, c.sSticker2); await sleep(400); }
                                    if (c.sSticker3) { await tgSticker(c.botToken, c.chatId, c.sSticker3); }
                                }
                            }
                            
                            if ((targetReached || !inTime) && c.endMsg) {
                                await sleep(400);
                                await tgMsg(c.botToken, c.chatId, c.endMsg);
                            }

                        } else {
                            internalState.martingaleActive = true; 
                            if (c.sendLoss) {
                                let lMsg = (c.lossMsg || '❌ LOSS! Result Number: {number}')
                                    .replace(/{number}/g, numberStr)
                                    .replace(/{size}/g, sizeStr);
                                if (lMsg) await tgMsg(c.botToken, c.chatId, lMsg);
                                await sleep(400);
                                if (c.lossSticker) await tgSticker(c.botToken, c.chatId, c.lossSticker);
                            }
                        }
                    }

                    if (!c.isActive) return; 
                    if (!inTime && !internalState.martingaleActive) return; 

                    await sleep(400);
                    const safetyStr = newOpposites.join(', ');
                    let signalText = (c.signalMsg || '')
                        .replace(/{period}/g, nextPeriodStr)
                        .replace(/{signal}/g, newPrediction)
                        .replace(/{safety}/g, safetyStr)
                        .replace(/{opposites}/g, safetyStr);
                        
                    await tgMsg(c.botToken, c.chatId, signalText);

                    internalState.lastSentPeriod = nextPeriodStr;
                    internalState.lastSentPred = newPrediction;
                    internalState.lastSentOpposites = newOpposites;
                    
                } catch(err) {
                    console.log(`❌ Error processing channel [${c.name}]:`, err.message);
                }
            })());
        }
    }
    
    await Promise.all(channelTasks);
}

async function safeFetch(url) {
    const timeUrl = url + '?t=' + Date.now();
    const encodedUrl = encodeURIComponent(timeUrl);
    
    const proxies = [
        `https://script.google.com/macros/s/AKfycbyKdJNB9kSmVg9Ye70z93knOaBQhkRUxkiis_fT9E6HGhRhxtJKkU1kpbvGDeCc5IQq3g/exec?url=${encodedUrl}`,
        `https://corsproxy.io/?url=${encodedUrl}`,
        `https://autumn-sun-c0ee.habiburrahman009000.workers.dev/?url=${encodedUrl}`,
        `https://api.allorigins.win/raw?url=${encodedUrl}`
    ];

    for (let i = 0; i < proxies.length; i++) {
        let proxyUrl = proxies[i];
        try {
            let res = await fetch(proxyUrl, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(10000)
            });
            
            if (res.ok) {
                let text = await res.text();
                
                if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                    let data = JSON.parse(text);
                    if (data && data.data && data.data.list) {
                        if (i > 0) {
                            console.log(`⚠️ Primary Google Proxy (Failed). Backup Proxy ${i} Succeeded!`);
                        }
                        return data;
                    }
                }
            }
        } catch(e) {}
    }
    return null;
}

async function fetchServerData(server) {
    if (!isServerNeeded(server)) {
        return; 
    }

    let state = serverStates[server];
    if (state.isFetching) return; 
    
    state.isFetching = true;
    try {
        const data = await safeFetch(APIS[server]);
        if (!data) {
            console.log(`❌ [${server}] API Data Fetch Error`);
            state.isFetching = false;
            return; 
        }

        const latest = data.data.list[0];
        const actualPeriod = latest.issueNumber;
        const actualSize = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
        const actualNumber = parseInt(latest.number);

        if (!state.p) {
            state.p = actualPeriod;
            const result = calculateD4XPrediction(data.data.list);
            state.pred = result.prediction;
            state.opposites = result.opposites;
            console.log(`📡 [${server}] Initialized. Period: ${actualPeriod}, Next Prediction: ${state.pred}`);
        } 
        else if (state.p !== actualPeriod) {
            const oldPeriod = state.p;
            state.p = actualPeriod;   
            
            const result = calculateD4XPrediction(data.data.list);
            const oldPred = state.pred;     
            const oldOpposites = state.opposites;
            
            state.pred = result.prediction;     
            state.opposites = result.opposites;
            
            let nextPeriodStr = (BigInt(actualPeriod) + 1n).toString();
            console.log(`⚡ [${server}] Period Changed! Old: ${actualPeriod} (${actualSize}). New Signal: ${result.prediction}`);
            
            processPeriodChange(server, oldPeriod, actualNumber, actualSize, result.prediction, result.opposites, nextPeriodStr);
        }
        state.isFetching = false;
    } catch (e) {
        state.isFetching = false;
        console.log(`⚠️ [${server}] Fetch Error:`, e.message);
    }
}

setInterval(() => fetchServerData('30S'), 6000);   
setInterval(() => fetchServerData('1M'), 12000);   
setInterval(() => fetchServerData('3M'), 30000);   
setInterval(() => fetchServerData('5M'), 45000);   

// 30 MIN WARNING CHECKER
setInterval(() => {
    let now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
    let currentMinutes = now.getHours() * 60 + now.getMinutes();
    let todayStr = now.toDateString();

    for (let key in channelsData) {
        let c = channelsData[key];
        
        if (!c.botToken || !c.chatId || !c.warningMsg || !c.times) continue;

        if (!channelActiveStates[key]) channelActiveStates[key] = { warningsSent: {} };
        let state = channelActiveStates[key];
        if (!state.warningsSent) state.warningsSent = {};

        let timesArray = Array.isArray(c.times) ? c.times : Object.values(c.times);

        timesArray.forEach((box, index) => {
            if (box && box.start) {
                let s = box.start.split(':');
                let startMin = parseInt(s[0]) * 60 + parseInt(s[1]);
                
                let diff = startMin - currentMinutes;
                if (diff < 0) diff += 1440; 

                if (diff === 30) {
                    if (state.warningsSent[index] !== todayStr) {
                        tgMsg(c.botToken, c.chatId, c.warningMsg);
                        state.warningsSent[index] = todayStr;
                    }
                }
            }
        });
    }
}, 60000); 

process.on('uncaughtException', err => {});
process.on('unhandledRejection', err => {});
