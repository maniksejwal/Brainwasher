# GUI for Care Circle

**Minimal, clean web interface** - White + Google Blue theme

---

## 🎯 Key Features

### Reused from CLI ✅
- Login flow
- Message sending
- Command execution
- Real-time updates (SSE)
- State management

### New in GUI ➕
- **View feedback history** (CLI can't do this!)
- **Run simulations visually** (CLI uses terminal scripts)
- **View analysis reports** (CLI uses file viewing)
- Quick feedback modal (Ctrl+F)

---

## 🎨 Design

**Colors**:
- Background: White (#FFFFFF)
- Primary: Google Blue (#4285F4)
- Text: Gray-900 (#212121)
- Borders: Gray-200 (#EEEEEE)

**Typography**:
- System fonts (-apple-system, Segoe UI, Roboto)
- Clean, readable
- Consistent spacing

**Inspired by**: Apple UI, Untitled UI, Google Material (minimal version)

---

## 🚀 Usage

```bash
# Start server
node server.js

# Open browser
http://localhost:5000/gui/

# Login with any username (same as CLI)
```

---

## 📊 Screenshots (What It Looks Like)

### Login Screen
```
┌──────────────────────┐
│                      │
│    Care Circle       │
│                      │
│  ┌────────────────┐  │
│  │ Enter username │  │
│  └────────────────┘  │
│                      │
│     [Continue]       │
│                      │
└──────────────────────┘
```

### Chat View
```
┌─────────────────────────────────────────┐
│ @alice (patient)          [👥] [📊] alice│
├─────────────────────────────────────────┤
│                                         │
│  ┌────────────────────────────────┐    │
│  │ PersonalAgent                  │    │
│  │ How are you feeling today?     │    │
│  └────────────────────────────────┘    │
│                                         │
│                   ┌─────────────────┐  │
│                   │ I feel dizzy    │  │
│                   └─────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│ Type a message...           [Send]      │
└─────────────────────────────────────────┘
```

### Feedback View
```
┌─────────────────────────────────────────┐
│ Training & Feedback        [Refresh]    │
├─────────────────────────────────────────┤
│ [My Feedback] [Simulations] [Analysis]  │
├─────────────────────────────────────────┤
│                                         │
│ 👍 +1   Oct 9, 2025 10:30 PM           │
│ "Great response timing"                 │
│                                         │
│ 👎 -1   Oct 9, 2025 10:25 PM           │
│ "Too verbose"                           │
│                                         │
│ 👌  0   Oct 9, 2025 10:20 PM           │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔧 Code Structure

```
gui/
├── index.html      # Structure (minimal)
├── styles.css      # White + Google Blue theme
├── app.js          # Logic (reuses CLI patterns)
├── config.js       # Browser-compatible config
└── README.md       # This file
```

**Total**: ~500 lines for complete GUI

---

## ✅ CLI vs GUI

### CLI Advantages
- Fast for power users
- No browser needed
- Terminal-native

### GUI Advantages
- Visual feedback viewing
- Simulation dashboard
- Analysis reports
- More accessible
- Better for demos

**Both use same backend** - choose what you prefer!

---

## 🛡️ Safety

- ✅ Doesn't modify CLI code
- ✅ Doesn't change server endpoints (just adds)
- ✅ Optional (can ignore if you prefer CLI)
- ✅ Works alongside CLI (both can run)

---

**Status**: 🟢 **Minimal GUI complete**  
**Design**: 🎨 **White + Google Blue (clean)**  
**Reuse**: ♻️ **Maximum** (same APIs as CLI)  
**New**: 📊 **Feedback viewing** (CLI doesn't have)

