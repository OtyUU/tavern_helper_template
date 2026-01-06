# 侧边栏 Overlay 系统

## 概述

这是一个为酒馆助手 (Tavern Helper) 开发的侧边栏叠加界面系统。它允许用户在酒馆界面中加载和显示自定义的HTML接口，提供一个可拖拽、可调整大小的浮动面板。

## 功能特性

- **浮动面板**：固定在屏幕上的可拖拽侧边栏
- **URL加载**：支持通过URL加载HTML接口
- **预设管理**：内置常用接口预设
- **状态持久化**：自动保存已加载的接口列表
- **响应式设计**：支持调整大小和位置
- **工具栏集成**：在酒馆脚本工具栏中添加切换按钮

## 安装与使用

### 1. 构建项目
```bash
pnpm build
```

### 2. 加载到酒馆
将生成的 `dist/侧边栏-overlay/index.js` 加载到酒馆中：

1. 打开酒馆设置
2. 进入"脚本"选项卡
3. 添加新脚本并指向生成的JS文件
4. 刷新页面

### 3. 使用侧边栏
- 点击酒馆界面中的"侧边栏"按钮打开/关闭面板
- 在输入框中输入HTML接口的URL
- 点击预设按钮快速加载示例接口
- 管理已加载的接口（显示和卸载）

## 技术实现

### 项目结构
```
src/侧边栏-overlay/
├── index.ts          # 入口文件，初始化脚本
├── Sidebar.vue       # Vue组件，UI界面
└── 样式.scss         # 样式定义
```

### 核心API使用

#### 1. 工具栏按钮集成
```typescript
replaceScriptButtons([{ name: '侧边栏', visible: true }]);
eventOn(getButtonEvent('侧边栏'), () => {
  window.$sidebarToggle();
});
```

#### 2. 样式注入
使用 `teleportStyle()` 将iframe内的样式应用到酒馆主页面

#### 3. 全局函数暴露
```typescript
window.$sidebarToggle = toggle;
```

### 与酒馆助手API集成

#### 状态管理
```typescript
// 使用酒馆变量持久化存储
const sidebarState = ref({
  isOpen: false,
  loadedUrls: [],
  position: { x: 20, y: 100 },
  size: { width: 300, height: 400 }
});

// 监听变化并自动保存
watch(sidebarState, (newState) => {
  replaceVariables(newState, { /* 变量配置 */ });
});
```

#### 消息系统
```typescript
// 触发接口加载事件
eventOn('SIDEBAR_LOAD_URL', (url) => {
  // 加载指定URL的接口
});

// 触发接口卸载事件
eventOn('SIDEBAR_UNLOAD_URL', (url) => {
  // 卸载指定接口
});
```

## 扩展功能

### 添加新预设
在 `Sidebar.vue` 中修改 presets 数组：

```typescript
const presets = [
  { name: '界面示例', url: 'dist/界面示例/index.html' },
  { name: '新接口', url: 'path/to/your/interface.html' },
];
```

### 自定义样式
修改 `样式.scss` 中的CSS变量和类名来自定义外观：

```scss
.sidebar-overlay {
  // 修改背景色、边框、阴影等
  background: rgba(30, 30, 40, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  // ...
}
```

## 注意事项

1. **跨域限制**：加载的HTML接口需要允许跨域访问
2. **安全性**：只加载可信来源的接口
3. **性能**：过多接口可能影响酒馆性能
4. **兼容性**：确保接口兼容酒馆的iframe环境

## 待改进功能

- [ ] 拖拽移动面板位置
- [ ] 接口内容的实际渲染显示
- [ ] 接口间的数据通信
- [ ] 更丰富的预设管理
- [ ] 面板最小化功能
- [ ] 快捷键支持

## 许可证

本项目遵循酒馆助手项目的整体许可证。
