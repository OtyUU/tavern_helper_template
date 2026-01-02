# Kinako Catgirl Character Card

This is a complete MVU (Message Variable Update) character card for Kinako, a cute catgirl character with playful personality.

## Structure

```
Kinako/
├── schema.ts              # Zod schema defining all character variables
├── schema.json            # Generated JSON schema for validation
├── 世界书/                # Worldbook entries
│   └── 变量/              # Variable-related worldbook entries
│       ├── initvar.yaml   # Initial variable values
│       ├── 变量列表.txt    # Variable list template
│       ├── 变量更新规则.yaml # Variable update rules
│       └── 变量输出格式.yaml # Variable output format
├── 界面/                  # UI components
│   ├── store.ts           # Pinia store for accessing MVU data
│   └── 状态栏/            # Status bar UI
│       ├── App.vue        # Vue component for status display
│       ├── index.html     # HTML entry point
│       ├── index.ts       # TypeScript entry point
│       └── global.css     # Global CSS styles
└── 脚本/                  # Scripts
    ├── MVU/              # MVU framework
    │   └── index.ts       # MVU loader
    └── 变量结构/          # Variable schema registration
        └── index.ts       # Schema registration script
```

## Variables

The character card includes the following variables:

### Core Stats
- `好感度` (Affection): 0-100, clamped
- `情绪` (Mood): Enum ['开心', '生气', '悲伤', '兴奋', '无聊'], default '开心'
- `能量` (Energy): 0-100, clamped
- `信任度` (Trust): 0-100, clamped
- `依赖度` (Dependency): 0-100, clamped

### Status
- `状态.饥饿` (Hunger): 0-100, clamped
- `状态.疲劳` (Fatigue): 0-100, clamped
- `状态.快乐` (Happiness): 0-100, clamped

### Inventory
- `物品栏`: Record of items with description and quantity (0-100)

### Achievements
- `称号`: Array of titles/achievements (max 5)

### Memory
- `记忆`: Array of events with timestamp

## Usage

1. **Initialization**: The `initvar.yaml` file provides default values for all variables
2. **Status Bar**: The Vue-based status bar displays all core stats in a clean interface
3. **MVU Integration**: The schema is automatically registered with the MVU framework
4. **Variable Updates**: The `变量更新规则.yaml` defines how variables should be updated based on events

## Building

To build this character card:

```bash
pnpm build
```

This will:
1. Generate the `schema.json` from `schema.ts`
2. Compile all TypeScript and Vue components
3. Output the built files to `dist/Kinako/`

## Integration

The built files in `dist/Kinako/` can be directly used in SillyTavern:
- Scripts go in the scripts directory
- UI components are loaded as iframes in message layers
- Worldbook entries can be imported into the character's lorebook

## Customization

To customize Kinako's behavior:
1. Edit `schema.ts` to modify variable definitions
2. Update `变量更新规则.yaml` to change update logic
3. Modify `initvar.yaml` to set different initial values
4. Adjust `App.vue` to change the status bar appearance