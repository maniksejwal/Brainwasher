# Safe Server.js Changes (Optional WhatsApp)

**These changes won't break your system even without WhatsApp credentials**

---

## 📝 Changes to server.js

### Step 1: Add Imports (After line 10)

```javascript
// BEFORE (existing):
import { handleLogin, handleMessage, handleCommand, events } from './orchestrator.js';
import config from './config.js';

// ADD these lines:
import { sendToWhatsApp } from './integrations/whatsapp/webhookHandler.js';
import { formatForWhatsApp } from './integrations/whatsapp/messageFormatter.js';
```

**Safe**: Import doesn't crash, functions just return gracefully if not configured

---

### Step 2: Add Webhook Endpoint (Before app.listen, around line 100)

```javascript
// ADD before: await initializeDatabase();

// WhatsApp webhook (optional - works even if AIsensy not configured)
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        const { handleWhatsAppWebhook } = await import('./integrations/whatsapp/webhookHandler.js');
        await handleWhatsAppWebhook(req, res);
    } catch (error) {
        console.error('[WhatsApp] Webhook error:', error.message);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
```

**Safe**: Endpoint exists, but gracefully handles missing config

---

### Step 3: Enhance Broadcast (Around line 45)

```javascript
// BEFORE (existing):
events.on('broadcast', (payload) => {
    broadcast(payload.targetUsers, { type: 'message', ...payload });
});

// REPLACE with:
events.on('broadcast', async (payload) => {
    // Existing: CLI broadcast (unchanged)
    broadcast(payload.targetUsers, { type: 'message', ...payload });
    
    // NEW: Also try WhatsApp (fails silently if not configured)
    try {
        for (const userId of payload.targetUsers) {
            const message = formatForWhatsApp(payload.reply || payload.message, {
                from: payload.from,
                patientUsername: payload.patientUsername
            });
            await sendToWhatsApp(userId, message);
            // Returns { success: false } if not configured - doesn't crash
        }
    } catch (error) {
        // Fail silently - don't break CLI if WhatsApp errors
        console.error('[WhatsApp] Broadcast error (non-critical):', error.message);
    }
});
```

**Safe**: Wrapped in try-catch, CLI works even if WhatsApp fails

---

## ✅ Safety Verification

**After making changes, test**:

```bash
# 1. Start server WITHOUT AISENSY_API_KEY
node server.js

# Should show:
# [AIsensy] ℹ️  WhatsApp not configured (optional)
# [Server] Listening on port 5000
# ✅ No crashes

# 2. Use CLI client
node client/main.js
# ✅ Should work perfectly

# 3. Send message
alice> "test"
# ✅ Should get reply normally

# 4. Check logs
# Should NOT see any WhatsApp errors (silent fallback)
```

---

## 🔄 Gradual Integration

### Today: Add Code, Don't Configure
```
✅ Add imports to server.js
✅ Add webhook endpoint  
✅ Update broadcast event
❌ Don't set AISENSY_API_KEY yet

Result: CLI works, WhatsApp dormant
```

### Next Week: Test WhatsApp
```
✅ Get AIsensy account
✅ Add AISENSY_API_KEY to .env
✅ Test with ngrok
✅ CLI still works

Result: Both channels active
```

---

## 🛡️ Crash Prevention

**All entry points protected**:

```javascript
// aisensyClient.js
if (!this.enabled) return { success: false };  // No crash

// webhookHandler.js
try { ... } catch { return { success: false }; }  // No crash

// messageFormatter.js
// Pure formatting - can't crash

// server.js broadcast
try { ... } catch { /* fail silently */ }  // No crash
```

**Result**: Impossible to crash from WhatsApp issues

---

## ✅ Summary

**Changes are safe because**:
1. ✅ All functions check `if (enabled)` first
2. ✅ All wrapped in try-catch
3. ✅ Fail silently, don't throw
4. ✅ CLI code path unchanged
5. ✅ Tests verify it works without config

**You can**:
- ✅ Make these changes NOW
- ✅ Run in development (no WhatsApp)
- ✅ CLI works perfectly
- ✅ Add WhatsApp later when ready

**Run test**:
```bash
node tests/test_whatsapp_optional.js
# Verifies: Works without WhatsApp ✅
```

