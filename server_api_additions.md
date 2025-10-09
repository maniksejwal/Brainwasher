# Server API Additions for GUI

**Add these endpoints to server.js for feedback/simulation viewing**

---

## 📝 New Endpoints (Add before app.listen)

```javascript
// ===== GUI-SPECIFIC ENDPOINTS =====

// Serve GUI (add at top of server.js)
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use('/gui', express.static(path.join(__dirname, 'gui')));

// Get user's feedback history
app.get('/api/feedback/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = await getDb();
        
        const feedback = await db.all(`
            SELECT * FROM feedback 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `, [userId]);
        
        res.json(feedback);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get detailed issue reports
app.get('/api/feedback/detailed/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = await getDb();
        
        const reports = await db.all(`
            SELECT * FROM detailed_feedback 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `, [userId]);
        
        res.json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger simulation (calls training system)
app.post('/api/simulate', async (req, res) => {
    try {
        const { runs = 5 } = req.body;
        
        // Import and run simulator
        const { SimulationDriver } = await import('./training/simulation/simulator.js');
        
        const scenario = {
            name: 'Quick GUI Simulation',
            users: [
                { userId: 'sim_patient', role: 'patient', personaKey: 'anxious_patient' }
            ],
            circle: { patientId: 'sim_patient', caregiverIds: [] },
            turns: 3
        };

        const sim = new SimulationDriver({ logResults: true });
        await sim.runScenario(scenario);
        await sim.cleanup();

        res.json({ success: true, runs, message: 'Simulation complete' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate analysis report
app.post('/api/analyze', async (req, res) => {
    try {
        const { FeedbackAnalyzer } = await import('./training/analysis/feedback_analyzer.js');
        
        const analyzer = new FeedbackAnalyzer();
        const result = await analyzer.generateReport();

        res.json({
            success: true,
            avgScore: result?.stats?.average_score || 0,
            total: result?.stats?.total_interactions || 0,
            report: 'training/analysis_report.md'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

---

## ✅ What These Add

| Endpoint | Purpose | CLI Has This? |
|----------|---------|---------------|
| `/gui` | Serve HTML/CSS/JS | ❌ No (CLI is terminal) |
| `/api/feedback/:userId` | View feedback history | ❌ No - new feature! |
| `/api/feedback/detailed/:userId` | View detailed reports | ❌ No - new feature! |
| `/api/simulate` | Run simulation | ❌ No (CLI uses scripts) |
| `/api/analyze` | Generate analysis | ❌ No (CLI uses scripts) |

**Key point**: GUI **adds** viewing capabilities that CLI doesn't have!

---

## 🎯 Code Reuse Strategy

### What GUI Reuses from CLI ✅

```javascript
// 1. Same login endpoint
fetch('/login') // ✅ Same as client/network.js

// 2. Same message sending
fetch('/send') // ✅ Same as client/network.js

// 3. Same command endpoint
fetch('/command') // ✅ Same as client/network.js

// 4. Same SSE connection
new EventSource('/events/:userId') // ✅ Same as client/network.js

// 5. Same state management pattern
const state = { userId, circleId, ... } // ✅ Same structure
```

### What GUI Adds (New Capabilities) ➕

```javascript
// GUI-SPECIFIC: View feedback
fetch('/api/feedback/:userId') // ➕ New

// GUI-SPECIFIC: Run simulations visually
fetch('/api/simulate') // ➕ New

// GUI-SPECIFIC: View analysis
fetch('/api/analyze') // ➕ New
```

---

## 📊 Comparison

### CLI (Terminal)

**Capabilities**:
- ✅ Chat with agents
- ✅ Use commands
- ✅ Give feedback (blind - can't see history)
- ❌ View past feedback
- ❌ Run simulations visually
- ❌ View analysis reports

**Files**: `client/main.js`, `client/network.js`, `client/ui.js`, `client/state.js`

### GUI (Browser)

**Capabilities**:
- ✅ Chat with agents (REUSED from CLI)
- ✅ Use commands (REUSED from CLI)
- ✅ Give feedback (REUSED from CLI)
- ✅ **View past feedback** (NEW!)
- ✅ **Run simulations** (NEW!)
- ✅ **View analysis** (NEW!)

**Files**: `gui/index.html`, `gui/styles.css`, `gui/app.js` (~500 lines total)

---

## 🎨 Design Philosophy

**Followed**: Apple UI + Untitled UI principles
- ✅ Mostly white
- ✅ Google blue for primary actions
- ✅ Minimal, clean
- ✅ No unnecessary elements
- ✅ Clear hierarchy
- ✅ Generous whitespace

---

## 🚀 To Use

```bash
# 1. Start server (serves GUI automatically)
node server.js

# 2. Open browser
http://localhost:5000/gui/

# 3. Login (same usernames as CLI)

# 4. Chat + View feedback/simulations!
```

**CLI still works** - just a different interface to same backend!

---

**Status**: 🟢 **GUI created with maximum code reuse**  
**New**: Feedback/simulation viewing (CLI doesn't have)  
**Safe**: Doesn't break anything ✅

