# Firefox Sprite Jitter During Camera Animation - RESOLVED ✅

## Проблема

При анимации камеры (pan и zoom) в Firefox спрайты немного дрожат. На Chrome такого дрожания нет.

### Симптомы
- Спрайты визуально "трясутся" или "дергаются" во время плавной анимации камеры
- Проблема проявляется только в Firefox
- На Chrome анимация полностью плавная
- Дрожание особенно заметно при использовании команд типа `camera at medium"xyz"`

### Пример кода, вызывающего проблему
```
scene
show mirai"xyz"
camera at medium"xyz"
show chinami at right
```

## Root Cause

**Проблема была в использовании `ease` timing function для CSS transitions в Firefox.**

Firefox имеет проблемы с синхронизацией вложенных трансформаций при использовании нелинейных easing функций (`ease`, `ease-in`, `ease-out`, `ease-in-out`). 

Когда родительский слой камеры анимируется с `transition: transform 600ms ease`, а внутри него находятся спрайты с их собственными трансформациями, Firefox не может точно синхронизировать кривые ускорения на разных уровнях вложенности, что приводит к визуальному дрожанию.

### Техническая причина:

1. **Родительский слой камеры:**
   ```css
   transform: scale(1.5) translate3d(100px, 50px, 0);
   transition: transform 600ms ease;
   ```

2. **Дочерние спрайты внутри:**
   ```css
   transform: translateY(-20px) scale(1.0);
   transition: transform 600ms ease;
   ```

3. **Проблема:** Firefox вычисляет промежуточные значения для `ease` кривой независимо для каждого уровня. Из-за ошибок округления и различий в timing, спрайты "дрожат" относительно фона.

4. **Почему Chrome не страдает:** Chrome использует другой алгоритм композитинга, который лучше справляется с синхронизацией вложенных easing кривых.

## Решение ✅

**Использовать `linear` timing function вместо `ease` для camera transitions.**

### Изменения:

**Файл:** `src/renpy-player/useRenpyPlayerController.ts`

```typescript
const backgroundCameraStyle = computed(() => {
  const panXMult = settings.value.bgPanParallax ?? 1;
  const panYMult = settings.value.bgPanParallaxY ?? 0.7;
  const ms = resolvedCameraTransitionMs.value;
  
  return {
    transform: `scale(${backgroundZoom.value}) translate3d(${cameraPanXPx.value * panXMult}px, ${cameraPanYPx.value * panYMult}px, 0)`,
    transformOrigin: 'center center',
    transition: ms > 0 ? `transform ${ms}ms linear` : 'none',  // ← linear вместо ease
  };
});

const spriteCameraStyle = computed(() => {
  const ms = resolvedCameraTransitionMs.value;
  
  return {
    transform: `scale(${spriteZoom.value}) translate3d(${cameraPanXPx.value}px, ${cameraPanYPx.value}px, 0)`,
    transformOrigin: 'center center',
    transition: ms > 0 ? `transform ${ms}ms linear` : 'none',  // ← linear вместо ease
  };
});
```

### Почему это работает:

1. **Линейная интерполяция проще:** `linear` timing function не имеет ускорения/замедления, поэтому Firefox легче синхронизирует вложенные трансформации

2. **Нет ошибок округления кривой:** С `ease` Firefox должен вычислять кубическую кривую Безье для каждого кадра. С `linear` это простая линейная интерполяция

3. **Предсказуемая синхронизация:** Все уровни вложенности движутся с одинаковой скоростью, что устраняет рассинхронизацию

4. **Минимальное визуальное отличие:** Для camera pan/zoom разница между `ease` и `linear` практически незаметна для пользователя, но критична для стабильности рендеринга в Firefox

## Итоговые изменения

**Всего 2 строки кода:**

```diff
 const backgroundCameraStyle = computed(() => {
   // ...
   return {
     transform: `scale(${backgroundZoom.value}) translate3d(...)`,
     transformOrigin: 'center center',
-    transition: ms > 0 ? `transform ${ms}ms ease` : 'none',
+    transition: ms > 0 ? `transform ${ms}ms linear` : 'none',
   };
 });

 const spriteCameraStyle = computed(() => {
   // ...
   return {
     transform: `scale(${spriteZoom.value}) translate3d(...)`,
     transformOrigin: 'center center',
-    transition: ms > 0 ? `transform ${ms}ms ease` : 'none',
+    transition: ms > 0 ? `transform ${ms}ms linear` : 'none',
   };
 });
```

## Альтернативные решения (не потребовались)

В процессе исследования были протестированы следующие подходы, которые **НЕ помогли**:

1. ❌ Условное применение `will-change: transform`
2. ❌ Удаление `backface-visibility: hidden`
3. ❌ Использование `translate3d` вместо `translate` (уже было)
4. ❌ Использование `left` вместо `transform` для позиционирования
5. ❌ Отключение transitions на дочерних элементах
6. ❌ `transform-style: preserve-3d`
7. ❌ `isolation: isolate`
8. ❌ `translateZ(0)` на спрайтах
9. ❌ Округление координат
10. ❌ `filter: blur(0px)`
11. ❌ `contain: layout style paint`

**Только изменение timing function с `ease` на `linear` решило проблему.**

