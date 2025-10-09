# Business System Integration Guide

How to integrate business negotiation without breaking medical functionality.

---

## 🔧 Integration Steps

### Step 1: Update server.js

**Current** (`server.js` around line 30-40):
```javascript
import { handleMessage } from './handlers/messageHandler.js';
import { handleCommand } from './handlers/commandHandler.js';
```

**Change to**:
```javascript
import { routeMessage } from './handlers/domainRouter.js';
```

**In message endpoint**:
```javascript
// Before
app.post('/send', async (req, res) => {
    await handleMessage(userId, circleId, message);
});

// After
app.post('/send', async (req, res) => {
    await routeMessage(userId, circleId, message);
});

// Same for /command endpoint
```

### Step 2: Initialize Business DB

```javascript
// Add to server.js startup
import { initializeBusinessSchema } from './db/business/schema.js';

// After medical DB init
await initializeBusinessSchema(db);
```

### Step 3: Verify (CRITICAL)

```bash
# 1. Run existing medical tests
npm test
# ALL MUST PASS

# 2. Try medical commands
node client/main.js
# Login as alice
/care bob as spouse    # Should work
/doc dr_smith          # Should work

# 3. Try business commands
/negotiate start @bob "Test" min:100 max:200
# Should work in parallel
```

---

## 🛡️ Safety Checklist

Before deploying:

- [ ] All existing medical tests pass
- [ ] Medical commands still work
- [ ] Business commands don't affect medical DB
- [ ] Session cleanup working
- [ ] Privacy guarantees verified

---

## 🔄 Rollback Plan

If issues arise:

**Step 1**: Revert server.js
```javascript
// Change back to:
import { handleMessage } from './handlers/messageHandler.js';
```

**Step 2**: Medical system unaffected
- Business code can stay in place
- Just not routed to

**Step 3**: Debug separately
- Fix business issues
- Test in isolation
- Re-integrate when ready

---

## 📊 Monitoring

After integration:

```javascript
// Check domain routing
console.log(stats):
  medicalMessages: 1000
  businessMessages: 50
  crossContamination: 0  // MUST BE ZERO
```

---

**Risk Level**: 🟡 LOW (if integration done correctly)  
**Rollback Time**: < 5 minutes  
**Testing Required**: ✅ Comprehensive

