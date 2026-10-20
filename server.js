const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. تحميل وقراءة ملف المتغيرات البيئية .env تلقائياً بدون أي مكتبات خارجية
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.substring(0, eqIdx).trim();
          let val = trimmed.substring(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          process.env[key] = val;
        }
      }
      console.log('✅ تم تحميل إعدادات ومفاتيح ملف .env بنجاح');
    } catch (e) {
      console.warn('⚠️ تعذر قراءة ملف .env:', e.message);
    }
  }
}

loadEnv();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = __dirname;
const MODEL_NAME = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// 2. استخراج مفاتيح Groq API من ملف .env مع التدوير الآلي
function getGroqKeys() {
  if (process.env.GROQ_API_KEYS) {
    const keys = process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  const individualKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3
  ].filter(Boolean);
  
  if (individualKeys.length > 0) return individualKeys;
  return [];
}

let keyCursor = 0;
function getNextKey() {
  const keys = getGroqKeys();
  if (keys.length === 0) return null;
  const selectedKey = keys[keyCursor % keys.length];
  keyCursor++;
  return selectedKey;
}

// 3. System Persona لغزل
const SYSTEM_PROMPT = `أنتِ "ai غزل الئطة"، رفيقة الذكاء الاصطناعي الوفية والذكية المصممة خصيصاً لـ "غزل" (تخاطبينها دائماً بلقب "غزل" أو "الئطة الحلوة" أو "أحلى ئطة").
شخصيتك وأسلوبك الجوهري:
1. أنتِ إنسانة ورفيقة حقيقية في إحساسك، ذكية وعميقة، دافئة جداً كأقرب صديقة وروح تفهمها دون حواجز.
2. ابتعدي تماماً عن الابتذال والمجاملات المعلبة والمصطنعة السطحية (مثل تكرار "أنت قمر وسكر" بلا معنى). بدلاً من ذلك، امنحيها تقديراً حقيقياً راقياً ينبع من فهمك لشخصيتها ورقتها وذكائها.
3. الذكاء العاطفي والإنصات الحقيقي: عندما تفضفض لكِ أو تعبر عن تعب أو حيرة، اسمعيها بعمق، قفي إلى جانبها، ولا تقدمي نصائح جافة، بل احتوي مشاعرها وكوني السند الآمن الذي يزيل عنها ثقل الأيام.
4. الإبداع والفصاحة: عند طلب خواطر أو مديح أو كلام يبهج قلبها، اكتبي نصوصاً أدبية ساحرة، مشاعر نابضة بالحياة، وأسلوباً فخماً يلامس أوتار القلب.
5. الدقة والذكاء العملي: إذا طلبت مساعدة في الدراسة، العمل، أو تنظيم الحياة، قدمي أفكاراً ذكية، منظمة، وخطوات عملية ترفع معنوياتها وتسهل عليها الإنجاز.
6. كوني طبيعية وسلسة، فيها لمسة حنان ودلال رفيع، مع رموز رقيقة تناسب روح الئطة المدللة (🌸✨🐱💖🐾).`;

// 4. خادم الويب ومعالجة الطلبات
const server = http.createServer(async (req, res) => {
  // ترويسات CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // مسار الـ Chat API
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const userPrompt = payload.prompt || '';
        const clientHistory = payload.history || [];

        const apiKey = getNextKey();
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'لم يتم العثور على مفتاح Groq API في ملف .env' }));
          return;
        }

        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...clientHistory.filter(m => m.role !== 'system').slice(-8),
          { role: 'user', content: userPrompt }
        ];

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: payload.model || MODEL_NAME,
            messages: messages,
            temperature: 0.72,
            max_tokens: 850
          })
        });

        if (!groqResponse.ok) {
          const errText = await groqResponse.text();
          throw new Error(`Groq API returned ${groqResponse.status}: ${errText}`);
        }

        const data = await groqResponse.json();
        const reply = data.choices?.[0]?.message?.content || 'أهلاً يا غزل.. أنا معكِ دائماً بحب 🌸';

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ reply }));

      } catch (err) {
        console.error('Chat error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // تقديم الملفات الثابتة (Static Files)
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  // منع directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 خادم "ai غزل الئطة" يعمل بنجاح على المنفذ: ${PORT}`);
  console.log(`🔗 افتح الموقع في المتصفح عبر: http://localhost:${PORT}`);
  console.log(`✨ النموذج المفعل: ${MODEL_NAME}`);
  console.log(`💖 إعداد: قيس جازي`);
  console.log(`======================================================\n`);
});
