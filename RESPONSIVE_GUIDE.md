# 📱 Guía de Diseño Responsive

## Breakpoints Estandarizados

```typescript
// src/constants/theme.ts
export const BREAKPOINTS = {
  sm: 640,   // Móvil pequeño
  md: 768,   // Tablet vertical
  lg: 1024,  // Tablet horizontal / Desktop pequeño
  xl: 1280,  // Desktop
  '2xl': 1536 // Desktop grande
}
```

## Estrategia Responsive por Dispositivo

### 📱 **Móvil (< 768px)**
- Sidebar oculto por defecto (hamburger menu)
- FAB (Floating Action Button) para acciones principales
- Header compacto
- Cards en 1 columna o 2 máximo
- Navbar inferior fijo

### 📲 **Tablet Vertical (768px - 1024px)**
- Sidebar colapsable (puede verse o esconderse)
- Header visible con búsqueda
- Cards en 2-3 columnas
- Más espacio para contenido

### 💻 **Tablet Horizontal / Desktop (> 1024px)**
- Sidebar siempre visible
- Header completo
- Cards en 4-5 columnas
- Layouts multi-columna

## Grid Responsivo

### Proyectos
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
  {/* 2 cols móvil, 3 tablet, 4-5 desktop */}
</div>
```

### Usuarios/Asignaciones
```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
  {/* 1 col móvil/tablet, 3 desktop */}
</div>
```

## Touch Targets (Para Tablet/Móvil)

**Mínimo 44x44px** para elementos táctiles:

```tsx
// ✅ CORRECTO
<button className="min-h-[44px] min-w-[44px] p-3">

// ❌ INCORRECTO
<button className="p-1">
```

## Spacing Adaptativo

```tsx
// Padding responsive
className="p-4 lg:p-8"        // 16px móvil, 32px desktop

// Gap responsive
className="gap-4 lg:gap-6"     // 16px móvil, 24px desktop

// Margin responsive
className="mb-4 lg:mb-8"       // 16px móvil, 32px desktop
```

## Texto Responsivo

```tsx
// Títulos
className="text-2xl lg:text-3xl"  // H1
className="text-xl lg:text-2xl"   // H2
className="text-lg lg:text-xl"    // H3

// Cuerpo
className="text-sm lg:text-base"  // Normal
className="text-xs lg:text-sm"    // Pequeño
```

## Imágenes Optimizadas

### 1. **Lazy Loading**
```tsx
<img
  src={url}
  loading="lazy"
  alt="..."
/>
```

### 2. **Tamaños Responsivos**
```tsx
<img
  srcSet="
    image-small.jpg 640w,
    image-medium.jpg 1024w,
    image-large.jpg 1920w
  "
  sizes="
    (max-width: 640px) 100vw,
    (max-width: 1024px) 50vw,
    33vw
  "
/>
```

### 3. **Placeholder mientras carga**
```tsx
<div className="bg-gray-800 animate-pulse aspect-[2/3]">
  <img
    src={url}
    className="w-full h-full object-cover"
    onLoad={() => setLoaded(true)}
  />
</div>
```

## Performance en Tablet

### ✅ **Optimizaciones Implementadas:**

1. **React.memo** para componentes que no cambian
2. **useMemo** para cálculos pesados
3. **useCallback** para funciones
4. **Lazy loading** de imágenes
5. **Skeleton loaders** para mejor UX
6. **Debounce** en búsquedas

### Ejemplo de optimización:

```tsx
// ❌ ANTES (sin optimización)
function ProjectCard({ proyecto }) {
  const progress = calculateProgress(
    proyecto.capitulos_actuales,
    proyecto.capitulos_totales
  );

  return <div>...</div>;
}

// ✅ DESPUÉS (optimizado)
const ProjectCard = React.memo(({ proyecto }) => {
  const progress = useMemo(
    () => calculateProgress(
      proyecto.capitulos_actuales,
      proyecto.capitulos_totales
    ),
    [proyecto.capitulos_actuales, proyecto.capitulos_totales]
  );

  return <div>...</div>;
});
```

## Gestos Táctiles (Para React Native)

Cuando migres a React Native, estos componentes soportan:

### Swipe
```tsx
// Swipe para eliminar en listas
<Swipeable
  renderRightActions={() => <DeleteButton />}
>
  <AsignacionCard />
</Swipeable>
```

### Pull to Refresh
```tsx
<ScrollView
  refreshControl={
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
    />
  }
>
```

### Long Press
```tsx
<TouchableOpacity
  onLongPress={() => showOptions()}
>
  <Card />
</TouchableOpacity>
```

## Testing Responsive

### Breakpoints para probar:
- **iPhone SE**: 375x667
- **iPhone 14**: 390x844
- **iPad Mini**: 768x1024
- **iPad Pro**: 1024x1366
- **Desktop**: 1920x1080

### Chrome DevTools:
1. F12
2. Toggle device toolbar (Ctrl+Shift+M)
3. Probar diferentes tamaños

## Checklist de Responsive ✅

- [ ] Funciona en móvil (< 768px)
- [ ] Funciona en tablet vertical (768px - 1024px)
- [ ] Funciona en tablet horizontal (> 1024px)
- [ ] Touch targets mínimo 44x44px
- [ ] Imágenes con lazy loading
- [ ] Texto legible en todos los tamaños
- [ ] Navegación funcional en móvil
- [ ] Sin scroll horizontal
- [ ] Modales responsive
- [ ] Forms fáciles de usar en touch
