# Card Interface Development Guide for Tavern Helper

This guide provides comprehensive instructions on how to develop interfaces for character cards in Tavern Helper and how to use them in SillyTavern.

## Table of Contents

1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Prerequisites](#prerequisites)
4. [Developing a Card Interface](#developing-a-card-interface)
5. [MVU-Enabled Character Cards](#mvu-enabled-character-cards)
6. [Building and Deployment](#building-and-deployment)
7. [Using Interfaces in Tavern Helper](#using-interfaces-in-tavern-helper)
8. [Available Libraries and Tools](#available-libraries-and-tools)
9. [Best Practices](#best-practices)
10. [Examples](#examples)

---

## Introduction

Tavern Helper is a framework that enables you to create custom frontend interfaces and scripts that run within SillyTavern. These interfaces can:

- Enhance character card displays with dynamic UI elements
- Create non-textual roleplay experiences with multimedia and interactive elements
- Optimize SillyTavern usage with custom tools and utilities
- Connect to external applications
- Add custom functionality like AI-powered summarization

Interfaces for character cards appear as iframes directly in message floors, providing rich, interactive displays that can communicate with SillyTavern through Tavern Helper's APIs.

---

## Project Structure

The project uses a modular structure where each interface or script is a self-contained folder in the `src/` directory:

```
src/
├── util/                 # Shared utility functions
├── 界面示例/              # Example frontend interface
│   ├── index.html       # HTML template
│   ├── index.ts         # Entry TypeScript file
│   └── *.vue           # Vue components
├── 脚本示例/              # Example background script
│   └── index.ts         # Script entry (no HTML)
└── 角色卡示例/            # Example MVU character card
    ├── schema.ts        # MVU variable schema (Zod)
    ├── 脚本/             # Card-specific scripts
    ├── 界面/             # Card-specific interfaces
    └── 世界书/            # World book entries
```

### Frontend Interface vs. Script

- **Frontend Interface**: Contains both `index.html` and `index.ts`
  - Runs in message floors as an iframe
  - Has its own visible UI
  - Examples: `界面示例`, `角色卡示例/界面/状态栏`

- **Script**: Contains only `index.ts`
  - Runs in the background without UI
  - Can modify the entire SillyTavern DOM
  - Examples: `脚本示例`, `角色卡示例/脚本`

---

## Prerequisites

### Required Software

- **Node.js** (v18+ recommended)
- **pnpm** package manager
- **Git** (for version control)

### Installation

```bash
# Clone or download the template
git clone <repository-url>
cd tavern_helper_template

# Install dependencies
pnpm install
```

### Development Setup

```bash
# Enable git merge strategy for dist folder conflicts
git config --global merge.ours.driver true
```

---

## Developing a Card Interface

### Step 1: Create Project Folder

Create a new folder in `src/` for your interface. The folder name will be the interface identifier.

```bash
mkdir -p src/my_character_interface
```

### Step 2: Create index.html

The HTML file provides the basic structure. Keep it minimal - all styles and scripts should be imported through TypeScript.

```html
<head></head>
<body>
  <div id="app"></div>
</body>
```

**Important Rules:**
- Do NOT use `<link rel="stylesheet">` or `<script src="">` for local files
- All imports should be done in TypeScript
- Do NOT use `src=""` placeholder in `<img>` tags
- Webpack will automatically inject bundled CSS and JS

### Step 3: Create index.ts

This is the entry point that initializes your Vue application.

```typescript
import { createApp } from 'vue';
import App from './App.vue';

// Always use $() for initialization
$(() => {
  createApp(App).mount('#app');
});

// Handle cleanup on unload
$(window).on('pagehide', () => {
  // Cleanup logic here
});
```

### Step 4: Create Vue Components

Create an `App.vue` file and any additional components.

```vue
<template>
  <div class="card-interface">
    <h1>{{ title }}</h1>
    <button @click="handleClick">Click Me</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const title = ref('My Character Interface');

function handleClick() {
  toastr.success('Button clicked!', 'Success');
}
</script>

<style lang="scss" scoped>
.card-interface {
  padding: 16px;
  background: #f5f5f5;
  border-radius: 8px;
}
</style>
```

### Step 5: Add Styling

You can use:
- **Scoped SCSS** in Vue components
- **Tailwind CSS** (create a CSS file with `@import 'tailwindcss'` and import it)
- **Global SCSS** (import in index.ts with `import './styles.scss'`)

```typescript
// index.ts
import './global.scss'; // Global styles
```

### Step 6: Access Tavern Helper APIs

Tavern Helper provides global APIs that you can use without imports:

```typescript
// Get chat messages
const message_id = getCurrentMessageId();
const messages = getChatMessages(message_id);

// Parse tavern macros
const character_name = substitudeMacros('{{char}}');

// Show notifications
toastr.success('Interface loaded!');
```

---

## MVU-Enabled Character Cards

If you're creating an interface for a character card that uses the MVU (Message Variable Update) framework, follow these additional steps.

### What is MVU?

MVU is a framework that allows character cards to have persistent variables stored in message floors, updated by AI or user interactions.

### Step 1: Define Variable Schema

Create or use a `schema.ts` file that defines your variables using Zod 4:

```typescript
export const Schema = z.object({
  角色: z.object({
    好感度: z.coerce.number().transform(value => _.clamp(value, 0, 100)),
    状态: z.record(z.string(), z.string()),
  }),
  物品栏: z.record(
    z.string().describe('Item name'),
    z.object({
      描述: z.string(),
      数量: z.coerce.number(),
    }),
  ),
});

export type Schema = z.output<typeof Schema>;
```

### Step 2: Create Data Store

In your interface folder, create `store.ts`:

```typescript
import { defineMvuDataStore } from '@/util/mvu';
import { Schema } from '../../schema';

// Accesses MVU variables from the current message floor
export const useDataStore = defineMvuDataStore(
  Schema,
  { type: 'message', message_id: getCurrentMessageId() },
  (data) => {
    // Optional: Initialize data on load
    if (!data.value.角色) {
      data.value.角色 = { 好感度: 50, 状态: {} };
    }
  }
);
```

### Step 3: Initialize with MVU Wait

Update your `index.ts` to wait for MVU initialization:

```typescript
import { waitUntil } from 'async-wait-until';
import App from './App.vue';
import './global.css';

$(async () => {
  // Wait for MVU framework to initialize
  await waitGlobalInitialized('Mvu');
  
  // Wait for message variables to be set
  await waitUntil(() => _.has(getVariables({ type: 'message' }), 'stat_data'));
  
  createApp(App).use(createPinia()).mount('#app');
});
```

### Step 4: Use Data in Components

```vue
<template>
  <div class="character-status">
    <h2>{{ data.角色?.名称 }}</h2>
    <p>Affection: {{ data.角色?.好感度 }}</p>
    
    <div v-for="(item, name) in data.物品栏" :key="name">
      {{ name }}: {{ item.数量 }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from './store';

const dataStore = useDataStore();
const { data } = storeToRefs(dataStore);

// Modifications are automatically synced
function increaseAffection(amount: number) {
  data.value.角色.好感度 += amount;
}
</script>
```

---

## Building and Deployment

### Development Mode

For live development with hot reload:

```bash
pnpm watch
```

This starts:
- Webpack in watch mode
- Socket.io server for live reload in Tavern
- Automatic schema dumping
- Tavern sync for asset management

### Production Build

```bash
pnpm build
```

This creates optimized, minified files in the `dist/` directory.

### Output Structure

After building, your interface will be at:
```
dist/my_character_interface/
└── index.html    # Self-contained HTML with embedded CSS/JS
```

### Hosting Options

#### Option 1: GitHub + jsDelivr (Recommended)

1. Push your code to GitHub
2. Enable GitHub Actions in repository settings
3. Set "Workflow permissions" to "Read and write permissions"
4. The CI workflow will automatically build and push to `dist/`
5. Access via: `https://cdn.jsdelivr.net/gh/username/repo@latest/dist/my_character_interface/index.html`

#### Option 2: Local Development Server

1. Start a local HTTP server (e.g., `python -m http.server 5500`)
2. Access via: `http://localhost:5500/dist/my_character_interface/index.html`

#### Option 3: Static File Hosting

Upload the `dist/` folder to any static file host (Netlify, Vercel, GitHub Pages, etc.)

---

## Using Interfaces in Tavern Helper

### Method 1: Direct Markdown Embedding

In your character card or world book, embed the interface using HTML:

```markdown
```
<body>
<script>
  $('body').load('https://cdn.jsdelivr.net/gh/username/repo@latest/dist/my_character_interface/index.html')
</script>
</body>
```
```

### Method 2: Using Tavern Helper's Script Feature

1. Open SillyTavern
2. Go to "Tavern Helper" → "Script Library"
3. Create a new interface script

Configure as JSON:
```json
{
  "id": "unique-id-here",
  "scriptName": "My Character Interface",
  "findRegex": ".*",
  "replaceString": "```html\n<body>\n<script>\n$('body').load('https://cdn.jsdelivr.net/gh/username/repo@latest/dist/my_character_interface/index.html')\n</script>\n</body>\n```",
  "trimStrings": [],
  "placement": [1, 2],
  "disabled": false,
  "markdownOnly": true,
  "promptOnly": false,
  "runOnEdit": false,
  "substituteRegex": 0,
  "minDepth": null,
  "maxDepth": null
}
```

**Key Fields:**
- `scriptName`: Display name
- `replaceString`: The HTML code to inject
- `placement`: `[min, max]` depth for message floors
- `disabled`: Set to `false` to enable

### Method 3: Character Card World Book

Add an entry in your character card's world book:

```yaml
uid: my_character_interface
key: [interface]
secondaryKeys: []
comment: Load character interface
content: |
  ```
  <body>
  <script>
    $('body').load('https://cdn.jsdelivr.net/gh/username/repo@latest/dist/my_character_interface/index.html')
  </script>
  </body>
  ```
```

### Live Development Testing

For development with local server:

```bash
# In one terminal
pnpm watch

# In another terminal
pnpm sync watch all -f
```

Then in Tavern Helper script:
```json
{
  "replaceString": "```html\n<body>\n<script>\n$('body').load('http://localhost:5500/dist/my_character_interface/index.html')\n</script>\n</body>\n```"
}
```

---

## Available Libraries and Tools

### Pre-installed Libraries

The project includes these libraries that you can use without installation:

**Core Frameworks:**
- Vue 3 - Reactive UI framework
- Pinia - State management
- Vue Router - Routing (use `createMemoryHistory()`)
- @vueuse/core - Vue composition utilities

**Utilities:**
- jQuery - DOM manipulation
- jQuery UI - UI interactions
- Lodash - Utility functions (available as `_`)
- GSAP - Animations
- Zod 4 - Schema validation
- Toastr - Notifications

**Data Handling:**
- YAML - YAML parsing/stringifying
- dedent - String dedenting
- klona - Deep cloning
- async-wait-until - Async utilities

**Graphics:**
- pixi.js - 2D rendering
- @pixi/react - React integration for PixiJS

**Auto-imported Functions:**

These are automatically available in your code:
- From Vue: `ref`, `computed`, `watch`, `onMounted`, etc.
- From Pinia: `defineStore`, `storeToRefs`
- From @vueuse/core: `useLocalStorage`, `useIntervalFn`, etc.
- From zod: `z` (for schema definitions)
- From dedent: `dedent`
- From klona: `klona`
- From vue-final-modal: `useModal`

### Adding New Libraries

```bash
pnpm add library-name
```

For type definitions:
```bash
pnpm add -D @types/library-name
```

### Tavern Helper Global APIs

Available without imports:

**Variables:**
```typescript
getVariables(options)
replaceVariables(data, options)
updateVariablesWith(updater, options)
```

**Chat:**
```typescript
getChatMessages(message_id?)
getCurrentMessageId()
substitudeMacros(text)
```

**Script/Iframe:**
```typescript
getScriptId()
getIframeName()
```

**Events:**
```typescript
eventOn(event, callback)
eventOff(event, callback?)
```

**MVU (if using MVU):**
```typescript
await waitGlobalInitialized('Mvu')
Mvu.getMvuData(options)
Mvu.replaceMvuData(data, options)
Mvu.parseMessage(message, oldData)
```

**Notifications:**
```typescript
toastr.success(message, title?)
toastr.error(message, title?)
toastr.info(message, title?)
toastr.warning(message, title?)
```

---

## Best Practices

### General Guidelines

1. **Use TypeScript over JavaScript** - Better type safety and developer experience
2. **Use Vue for interfaces** - More maintainable than jQuery/DOM manipulation
3. **Use Pinia for state** - Reactive state management with persistence
4. **Use Zod for validation** - Robust data validation and error handling

### Loading and Initialization

✅ **Correct:**
```typescript
$(() => {
  // Initialize here
});
```

❌ **Wrong:**
```typescript
document.addEventListener('DOMContentLoaded', () => {
  // Won't work with dynamic loading
});
```

### Cleanup

```typescript
$(window).on('pagehide', () => {
  // Cleanup resources
});
```

### Router Configuration

Always use memory history for iframes:
```typescript
import { createMemoryHistory, createRouter } from 'vue-router';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [...],
});
```

### State Persistence

When persisting reactive state to variables:
```typescript
const data = ref(settings.parse(getVariables({ type: 'script', script_id: getScriptId() })));

watchEffect(() => {
  // Use klona to remove proxy layers
  replaceVariables(klona(data.value), { type: 'script', script_id: getScriptId() });
});
```

### Error Handling

```typescript
// Use console.info for logging
console.info('Interface loaded successfully');

// Use console.warn/error for recoverable errors
console.warn('Variable not found, using default');

// Use throw for fatal errors
throw new Error('Failed to initialize interface');

// Wrap top-level functions
function init() { /* ... */ }

$(() => {
  errorCatched(init)();
});
```

### Styling Guidelines

1. **Avoid `vh` units** - Use width and aspect-ratio instead
2. **Avoid forced height elements** - Don't use `min-height` or `overflow: auto` that can break iframe layout
3. **Use external support** - Main content should not use `position: absolute`
4. **Fit container width** - Avoid horizontal scrollbars
5. **Card-style interfaces** - Should not have background color unless explicitly requested

### MVU Best Practices

1. **Wait for initialization:**
```typescript
await waitGlobalInitialized('Mvu');
await waitUntil(() => _.has(getVariables({ type: 'message' }), 'stat_data'));
```

2. **Use `defineMvuDataStore`:**
```typescript
const dataStore = defineMvuDataStore(
  Schema,
  { type: 'message', message_id: getCurrentMessageId() }
);
```

3. **Schema rules:**
- Use `z.coerce.number()` for numeric inputs
- Use `z.transform()` for data transformations
- Use `.prefault()` for default values
- Avoid `.optional()` - use `.prefault({})` instead

---

## Examples

### Example 1: Simple Status Display

```vue
<template>
  <div class="status-display">
    <h3>{{ characterName }}</h3>
    <div class="stats">
      <div class="stat">
        <span class="label">Health:</span>
        <span class="value">{{ health }} / 100</span>
      </div>
      <div class="stat">
        <span class="label">Energy:</span>
        <span class="value">{{ energy }} / 100</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const characterName = ref('');
const health = ref(100);
const energy = ref(100);

onMounted(() => {
  characterName.value = substitudeMacros('{{char}}');
});
</script>

<style lang="scss" scoped>
.status-display {
  padding: 12px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  
  .stats {
    margin-top: 8px;
    display: flex;
    gap: 12px;
    
    .stat {
      display: flex;
      gap: 4px;
      
      .label {
        font-weight: bold;
      }
    }
  }
}
</style>
```

### Example 2: Interactive Buttons with Slash Commands

```vue
<template>
  <div class="action-buttons">
    <button v-for="action in actions" :key="action.id" @click="executeAction(action)">
      {{ action.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
const actions = [
  { id: 'greet', label: 'Say Hello', command: '/echo Hello from interface!' },
  { id: 'roll', label: 'Roll Dice', command: '/roll 2d6' },
];

async function executeAction(action: any) {
  // Trigger a slash command
  await triggerSlash(action.command);
  toastr.success(`Executed: ${action.label}`);
}
</script>

<style lang="scss" scoped>
.action-buttons {
  display: flex;
  gap: 8px;
  
  button {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #4a90e2;
    color: white;
    cursor: pointer;
    transition: background 0.2s;
    
    &:hover {
      background: #357abd;
    }
  }
}
</style>
```

### Example 3: MVU Character Status Bar

```vue
<template>
  <div class="status-bar">
    <div class="character-info">
      <h4>{{ data.角色?.名称 || 'Unknown' }}</h4>
      <div class="affection-bar">
        <div class="bar-label">Affection</div>
        <div class="bar-container">
          <div class="bar-fill" :style="{ width: `${data.角色?.好感度 || 0}%` }"></div>
        </div>
        <div class="bar-value">{{ data.角色?.好感度 || 0 }}</div>
      </div>
    </div>
    
    <div class="inventory">
      <h5>Inventory</h5>
      <div v-for="(item, name) in data.物品栏" :key="name" class="item">
        <span class="item-name">{{ name }}</span>
        <span class="item-count">x{{ item.数量 }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore } from './store';

const dataStore = useDataStore();
const { data } = storeToRefs(dataStore);

function modifyAffection(delta: number) {
  data.value.角色.好感度 = Math.max(0, Math.min(100, data.value.角色.好感度 + delta));
}
</script>

<style lang="scss" scoped>
.status-bar {
  background: #fafafa;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  
  .affection-bar {
    margin: 8px 0;
    
    .bar-container {
      height: 20px;
      background: #eee;
      border-radius: 10px;
      overflow: hidden;
      
      .bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #ff6b6b, #feca57);
        transition: width 0.3s;
      }
    }
  }
  
  .inventory {
    margin-top: 12px;
    border-top: 1px solid #eee;
    padding-top: 8px;
    
    .item {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
  }
}
</style>
```

---

## Troubleshooting

### Interface Not Loading

1. Check browser console for errors
2. Verify the URL is correct and accessible
3. Ensure Tavern Helper script is enabled
4. Check that `script_id` matches your script ID

### MVU Variables Not Working

1. Ensure MVU framework is initialized:
```typescript
await waitGlobalInitialized('Mvu');
```

2. Wait for variables to exist:
```typescript
await waitUntil(() => _.has(getVariables({ type: 'message' }), 'stat_data'));
```

3. Verify schema matches your data structure

### Hot Reload Not Working

1. Ensure `pnpm watch` is running
2. Check that socket.io server is accessible
3. Refresh the message in SillyTavern

### Build Errors

1. Clear cache: `rm -rf dist node_modules/.cache`
2. Reinstall dependencies: `pnpm install`
3. Check for syntax errors in TypeScript files

---

## Additional Resources

- [Tavern Helper Documentation](https://n0vi028.github.io/JS-Slash-Runner-Doc/)
- [Vue 3 Documentation](https://vuejs.org/)
- [Pinia Documentation](https://pinia.vuejs.org/)
- [Zod Documentation](https://zod.dev/)
- [Project README](../README.md)

---

## Support

For issues or questions:
1. Check existing examples in `src/界面示例` and `src/角色卡示例`
2. Review the rules in `.cursor/rules/` for detailed guidelines
3. Consult the Tavern Helper documentation
4. Check browser console and terminal logs for errors

---

## License

This template is licensed under the Aladdin License. See [LICENSE](../LICENSE) for details.
