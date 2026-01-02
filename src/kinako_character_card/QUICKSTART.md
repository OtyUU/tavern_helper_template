# Kinako Character Card - Quick Start Guide

## Overview
This is a complete MVU (Model-View-Update) character card for Kinako, featuring:
- Interactive status bar interface with affection tracking
- Dynamic variable system for tracking relationship progress
- Comprehensive worldbook integration
- Beautiful UI with custom color scheme

## Quick Start

### 1. Build the Project
```bash
pnpm build
# or for development with live reload:
pnpm watch
```

### 2. Files Generated
After building, you'll find the following in `dist/kinako_character_card/`:
- `scripts/mvu/index.js` - MVU framework loader
- `scripts/variable_structure/index.js` - Schema registration
- `interfaces/status_bar/index.html` - Status bar UI (fully self-contained)

### 3. Setup in SillyTavern

#### Load Scripts
Add these scripts to your character or chat:
1. **MVU Framework**: Import `dist/kinako_character_card/scripts/mvu/index.js`
2. **Variable Schema**: Import `dist/kinako_character_card/scripts/variable_structure/index.js`

#### Import Worldbook
Import the worldbook from `worldbook/index.yaml` using SillyTavern's worldbook import feature.

#### Display Status Bar
In any message, you can load the status bar by importing:
```
dist/kinako_character_card/interfaces/status_bar/index.html
```

The status bar will automatically:
- Display current world state (time, location, weather)
- Show Kinako's affection level with visual progress bar
- Display Kinako's current mood, energy, and activities
- Track Sato's inventory and gifts

### 4. Customize Initial Values

Edit `worldbook/variables/initvar.yaml` to set starting conditions:
- Starting affection level
- Initial mood and energy
- Beginning outfit
- Starting inventory items
- First location and time

After editing, enable the `[initvar]变量初始化勿开` worldbook entry to initialize variables.

## Character Information

### Kinako's Profile
- **Species**: Cat-girl
- **Appearance**: Sandy blonde hair, teal eyes, cat ears and tail
- **Personality**: Playful, affectionate, childish, prone to tantrums
- **Age**: Young adult appearance with childlike behavior

### Relationship Stages
Based on affection level:
- **0-20**: Distant - keeping her distance
- **20-40**: Warming Up - starting to trust
- **40-60**: Attached - comfortable and affectionate
- **60-80**: Deeply Bonded - very close, seeks constant attention
- **80-100**: Devoted - completely attached to Sato

### Moods
- **Happy**: Content and smiling
- **Playful**: Energetic, wants to play
- **Pouty**: Slightly upset, demanding attention
- **Sleepy**: Tired, low energy
- **Curious**: Investigating something new
- **Tantrum**: Actively upset, throwing a fit
- **Clingy**: Needs constant physical contact

## Variable System

### How It Works
The AI automatically updates variables at the end of each response using JSON Patch format:
```json
[
  { "op": "replace", "path": "/kinako/mood", "value": "playful" },
  { "op": "delta", "path": "/kinako/affection", "value": 5 },
  { "op": "insert", "path": "/sato/inventory/New Item", "value": {...} }
]
```

### Update Rules
- **Affection**: Changes ±2-5 for normal interactions, ±5-10 for significant events
- **Mood**: Updates based on current activity and interactions
- **Energy**: Decreases with activity (-5-15), increases with rest (+20-40)
- **Time**: Progresses 5-60 minutes per interaction

### Tracking Progress
The status bar automatically displays all variable changes in real-time, including:
- Visual affection bar with percentage and stage
- Current mood with color-coded badge
- Energy level display
- Inventory with quantities
- Gift history

## Tips for Best Experience

1. **Start Small**: Begin with simple interactions to establish the relationship
2. **Watch Energy**: When energy is low (<20), Kinako needs rest
3. **Mood Matters**: Different moods respond better to different activities
4. **Build Affection**: Consistent positive interactions build trust over time
5. **Use Gifts**: Giving items from inventory increases affection
6. **Time Progression**: Let realistic amounts of time pass between events

## Customization

### Change Color Scheme
Edit `interfaces/status_bar/global.css`:
```css
:root {
  --c-kinako-cream: #fff5e6;
  --c-kinako-gold: #f4d58d;
  --c-kinako-teal: #5eb3b3;
  --c-kinako-dark: #3c4950;
  --c-kinako-pink: #ffb6c1;
}
```

### Add New Variables
1. Edit `schema.ts` to define new fields
2. Update `worldbook/variables/变量更新规则.yaml` with update rules
3. Modify UI components to display new variables
4. Run `pnpm build` to regenerate

### Modify Update Rules
Edit `worldbook/variables/变量更新规则.yaml` to change how variables update:
- Adjust affection gain/loss amounts
- Add new conditions for mood changes
- Modify energy consumption rates
- Add new event types

## Troubleshooting

### Status Bar Not Showing
- Ensure MVU script is loaded first
- Check that variables are initialized (enable initvar entry)
- Verify the message contains the status bar HTML

### Variables Not Updating
- Check that variable update rules entry is enabled
- Verify variable output format entry is enabled
- Look for MVU errors in browser console

### Affection Not Changing
- Ensure interactions are significant enough to trigger updates
- Check that update rules are not too restrictive
- Verify AI is outputting proper JSON Patch format

## Support

For issues or questions:
1. Check the README.md for detailed documentation
2. Review the example character card in `src/角色卡示例`
3. Examine the schema.ts to understand variable structure
4. Test with `pnpm watch` to see live updates during development
