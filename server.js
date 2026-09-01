/**
 * 吉林区稽核质检工作台 - 云协同服务器
 * 零依赖，仅需 Node.js 即可运行
 * 用法: node server.js
 * 访问: http://localhost:3000  或  http://[本机IP]:3000 (局域网)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HTML_FILE = path.join(__dirname, '吉林区稽核质检工作台.html');
const DATA_FILE = path.join(__dirname, 'shared-state.json');

// 所有需要协同的数据模块
const SECTIONS = [
    'OVERVIEW', 'TODO_DATA', 'MODULE_DATA', 'CLOSED_LOOP_DETAIL',
    'SCORE_DATA', 'RISK_TOP5', 'TEAM_DATA', 'ISSUE_DATA',
    'SOP_LIST', 'PENALTY_DATA'
];

// 初始化共享状态（按模块分片，各自带时间戳和最后编辑人）
let sharedState = {};
for (const s of SECTIONS) {
    sharedState[s] = { data: null, ts: 0, user: '' };
}

// 从磁盘恢复
if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        for (const s of SECTIONS) {
            if (loaded[s]) sharedState[s] = loaded[s];
        }
        console.log('[恢复] 已从磁盘加载共享状态');
    } catch (e) {
        console.error('[恢复] 失败:', e.message);
    }
}

// 在线用户追踪: Map<name, lastHeartbeat>
const onlineUsers = new Map();

// 解析 JSON body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// 持久化到磁盘
function persistState() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(sharedState));
    } catch (e) {
        console.error('[持久化] 失败:', e.message);
    }
}

// 清理过期用户（15秒无心跳）
function cleanExpiredUsers() {
    const now = Date.now();
    for (const [name, ts] of onlineUsers) {
        if (now - ts > 15000) onlineUsers.delete(name);
    }
}

// 获取本机局域网 IP
function getLocalIPs() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // ---------- 静态文件 ----------
    if (pathname === '/' || pathname === '/index.html') {
        try {
            const html = fs.readFileSync(HTML_FILE, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (e) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('工作台 HTML 文件未找到: ' + HTML_FILE);
        }
        return;
    }

    // ---------- API: 获取全部状态 ----------
    if (pathname === '/api/state' && req.method === 'GET') {
        cleanExpiredUsers();
        const result = {
            sections: sharedState,
            online: [...onlineUsers.keys()],
            serverTime: Date.now()
        };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
        return;
    }

    // ---------- API: 保存单个模块 ----------
    if (pathname === '/api/section' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { section, data, user } = body;
            if (!SECTIONS.includes(section)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '未知模块: ' + section }));
                return;
            }
            const ts = Date.now();
            sharedState[section] = { data, ts, user: user || '未知' };
            persistState();
            console.log(`[保存] ${user || '未知'} -> ${section} @ ${new Date(ts).toLocaleTimeString('zh-CN')}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ts, section, user }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // ---------- API: 心跳 ----------
    if (pathname === '/api/heartbeat' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { user } = body;
            if (user) {
                onlineUsers.set(user, Date.now());
            }
            cleanExpiredUsers();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ online: [...onlineUsers.keys()] }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // ---------- API: 重置全部 ----------
    if (pathname === '/api/reset' && req.method === 'POST') {
        for (const s of SECTIONS) {
            sharedState[s] = { data: null, ts: Date.now(), user: 'system' };
        }
        persistState();
        console.log('[重置] 所有模块已清空');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log('');
    console.log('  ════════════════════════════════════════════');
    console.log('  吉林区稽核质检工作台 - 云协同服务器');
    console.log('  ════════════════════════════════════════════');
    console.log('');
    console.log('  本机访问:  http://localhost:' + PORT);
    ips.forEach(ip => {
        console.log('  局域网:    http://' + ip + ':' + PORT);
    });
    console.log('');
    console.log('  支持多人同时编辑，数据每 5 秒自动同步');
    console.log('  按 Ctrl+C 停止服务');
    console.log('');
});
