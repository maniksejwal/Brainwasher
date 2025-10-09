# WhatsApp Integration via AIsensy

**Approach**: Add WhatsApp as a new client channel WITHOUT touching existing CLI client.

---

## 🏗️ Architecture

```mermaid
graph TB
    subgraph Clients["Client Channels"]
        CLI[CLI Client<br/>client/main.js<br/>EXISTING]
        WA[WhatsApp<br/>via AIsensy<br/>NEW]
    end
    
    subgraph Server["Server (Unchanged Core)"]
        Webhook[/webhook/whatsapp<br/>NEW endpoint]
        Login[/login]
        Send[/send]
        Command[/command]
        Events[/events SSE]
    end
    
    subgraph Core["Core System (Untouched)"]
        Orch[orchestrator.js]
        Handler[messageHandler.js]
        Agents[AI Agents]
    end
    
    CLI --> Login
    CLI --> Send
    CLI --> Command
    CLI <--> Events
    
    WA --> Webhook
    Webhook --> Orch
    
    Login --> Orch
    Send --> Orch
    Command --> Orch
    
    Orch --> Handler
    Handler --> Agents
    
    Agents -.Reply.-> Orch
    Orch -.Broadcast.-> CLI
    Orch -.Send via AIsensy.-> WA
    
    style CLI fill:#e1f5e1
    style WA fill:#25D366
    style Core fill:#fff4e1
```

---

## 📦 Implementation Plan

### 1. Install AIsensy SDK
```bash
npm install axios  # For WhatsApp API calls
```

### 2. Create WhatsApp Adapter (New File)
```
integrations/
├── whatsapp/
│   ├── aisensyClient.js    # API wrapper
│   ├── webhookHandler.js   # Incoming messages
│   └── messageFormatter.js # Format for WhatsApp
```

### 3. Add Webhook Endpoint (server.js)
```javascript
// One new endpoint, existing code unchanged
app.post('/webhook/whatsapp', handleWhatsAppWebhook);
```

### 4. User Mapping (Database)
```sql
-- Link WhatsApp numbers to user_ids
CREATE TABLE whatsapp_users (
    phone_number TEXT PRIMARY KEY,
    user_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);
```

---

## 🔧 Non-Breaking Integration

### Principle
- ✅ CLI client works exactly as before
- ✅ WhatsApp is additional channel
- ✅ Same orchestrator, handlers, agents
- ✅ Just different input/output adapters

### Files Created (All NEW)
- `integrations/whatsapp/aisensyClient.js`
- `integrations/whatsapp/webhookHandler.js`
- `integrations/whatsapp/messageFormatter.js`

### Files Modified (Minimal)
- `server.js` - Add ONE webhook endpoint
- `db/schema.js` - Add ONE table
- `orchestrator.js` - Add WhatsApp to broadcast (optional)

---

## 📝 Next Steps

1. Get AIsensy API credentials
2. Create integration files
3. Test with one user
4. CLI still works in parallel

**Ready to implement?** I'll be very careful not to break anything!

