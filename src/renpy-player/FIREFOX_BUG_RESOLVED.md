# Firefox Animation Bugs - Resolved

## Проблема 1: Зависание при команде `hide` ✅ RESOLVED

### Симптомы
- Команда `hide mirai"xyz"` вызывала полное зависание плеера на Firefox
- Интерфейс пропадал, не было реакции на клик
- Плеер застревал в фазе `scene` и не переходил к `reveal`
- На Chrome работало корректно

### Root Cause

**Проблема была в использовании `requestAnimationFrame` для запуска Web Animations API.**

Firefox имеет другой timing для `requestAnimationFrame` по сравнению с Chrome. Код внутри двойного RAF не выполнялся или выполнялся слишком поздно, что приводило к тому, что:
1. `node.animate()` никогда не вызывался
2. Event listeners для `finish`/`cancel` не устанавливались
3. `complete()` callback никогда не вызывался
4. `bus.count` оставался > 0 навсегда
5. Phase FSM ждал `bus.count === 0` бесконечно

### Решение

**Убрать `requestAnimationFrame` и выполнять код синхронно.**

```typescript
// БЫЛО (с багом):
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const animation = node.animate(...);
    // ...
  });
});

// СТАЛО (исправлено):
if (finished) return;
try {
  const animation = node.animate(...);
  // ...
} catch (err) {
  cleanupBus();
  complete();
}
```

**Файл:** `src/renpy-player/player-composables.ts`, функция `onSpriteLeave()`

---

## Проблема 2: HUD hide анимация не работает ✅ RESOLVED

### Симптомы
- HUD движется вниз (slide работает), затем резко пропадает без fade
- Потом резко появляется без fade
- Только `transform` transition работал, `opacity` - нет
- Проблема только на Firefox

### Root Cause

**Firefox блокирует `opacity` transitions на элементах с `will-change: opacity, transform`.**

Это известная особенность Firefox: когда `will-change` включает `opacity`, браузер может создать отдельный композитный слой, который **блокирует CSS transitions для opacity** вместо того, чтобы их ускорять.

Последовательность проблемы:
1. Элемент имеет `will-change: opacity, transform`
2. При смене класса с `--visible` на `--hidden`:
   - `transform` transition работает (slide вниз)
   - `opacity` transition **не работает** (резкое исчезновение)
3. Firefox применяет `opacity: 0` мгновенно, игнорируя `transition: opacity 0.26s`

### Решение

**Убрать `opacity` из `will-change`, оставить только `transform`.**

```scss
// БЫЛО (с багом):
.renpy-player__hud-shell {
  will-change: opacity, transform;
}

// СТАЛО (исправлено):
.renpy-player__hud-shell {
  will-change: transform;
}
```

**Файл:** `src/renpy-player/renpy-player.scss`

Это единственное изменение, которое потребовалось для исправления проблемы. Никаких дополнительных задержек или JavaScript логики не понадобилось.

---

## Технические детали

### Почему `will-change: opacity` блокирует transitions на Firefox?

1. **Композитные слои**: `will-change: opacity` заставляет Firefox создать отдельный композитный слой для элемента
2. **Оптимизация vs transitions**: Firefox оптимизирует этот слой таким образом, что CSS transitions для `opacity` перестают работать
3. **Chrome vs Firefox**: Chrome обрабатывает `will-change` иначе и не имеет этой проблемы

### Почему `transform` transition работал?

`transform` transitions обрабатываются на GPU и не зависят от композитных слоев для `opacity`. Поэтому slide анимация работала, а fade - нет.

### Почему убрание `opacity` из `will-change` помогло?

Без `will-change: opacity` Firefox:
1. Не создает специальный композитный слой для opacity
2. Обрабатывает `opacity` transitions нормально через CSS engine
3. Применяет плавный fade как и ожидается

---

## Выводы

### Урок 1: requestAnimationFrame ненадежен для критичной логики
`requestAnimationFrame` имеет разный timing на разных браузерах. Для критичной логики (как TransitionBus) лучше использовать синхронное выполнение.

### Урок 2: will-change может навредить
`will-change` - это hint для браузера, а не гарантия улучшения производительности. На Firefox `will-change: opacity` **блокирует** transitions вместо того, чтобы их ускорять.

### Урок 3: Тестируйте на Firefox
Firefox имеет множество специфичных особенностей в обработке CSS и анимаций. То, что работает на Chrome, может не работать на Firefox.

### Урок 4: Минимализм в will-change
Используйте `will-change` только для свойств, которые действительно нуждаются в оптимизации. В данном случае достаточно было `will-change: transform`.

---

## Статус

✅ **RESOLVED** - Обе проблемы полностью исправлены

**Дата:** 2026-05-12  
**Приоритет:** P0 (Критический)  
**Затронутые браузеры:** Firefox  

**Исправления:**
1. Убран `requestAnimationFrame` из `onSpriteLeave` → исправлено зависание при `hide`
2. Убран `opacity` из `will-change` → исправлена HUD fade анимация

**Тестирование:**
- ✅ Firefox - обе проблемы исправлены
- ✅ Chrome - нет регрессий

---

## Итоговые изменения

Для исправления обоих багов потребовалось **всего 2 минимальных изменения**:

### 1. `src/renpy-player/player-composables.ts`
Убрана 1 строка с `requestAnimationFrame` в функции `onSpriteLeave()`:
```diff
- requestAnimationFrame(() => {
-   if (finished) return;
-   try {
+ if (finished) return;
+ 
+ try {
```

### 2. `src/renpy-player/renpy-player.scss`
Изменена 1 строка в `.renpy-player__hud-shell`:
```diff
- will-change: opacity, transform;
+ will-change: transform;
```

**Никаких других изменений не требуется:**
- ❌ Не нужны fallback timeouts
- ❌ Не нужна ручная установка `opacity`
- ❌ Не нужны задержки перед показом HUD
- ❌ Не нужна синхронизация transition durations
- ❌ Не нужны изменения в `fill: 'forwards'`

Простые и элегантные решения, которые устраняют root cause проблем.
