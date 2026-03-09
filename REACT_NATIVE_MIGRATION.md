# 📱 Guía de Migración a React Native

## 🎯 Objetivo
Convertir tu aplicación web Next.js en una app móvil (APK) reutilizando el máximo código posible.

## 📊 Reutilización de Código

### ✅ **100% Reutilizable** (Copy & Paste)
- `src/constants/theme.ts` - Toda la configuración de colores y estilos
- `src/utils/helpers.ts` - Todas las funciones helper
- `src/services/api.ts` - Servicio API completo
- Toda la lógica de negocio (hooks, funciones)

### 🔄 **Requiere Adaptación** (Cambios mínimos)
- Componentes visuales (JSX → React Native components)
- Navegación (Next.js Router → React Navigation)
- Storage (localStorage → AsyncStorage)

### ❌ **No Reutilizable**
- Componentes específicos de Next.js (App Router, etc.)
- CSS/Tailwind (usar StyleSheet de RN)

---

## 🚀 Setup Inicial

### 1. Instalar React Native
```bash
npx react-native init AnimeBBGMobile
cd AnimeBBGMobile
```

### 2. Instalar Dependencias
```bash
# Navegación
npm install @react-navigation/native @react-navigation/native-stack
npm install react-native-screens react-native-safe-area-context

# UI Components
npm install react-native-paper
npm install react-native-vector-icons

# AsyncStorage
npm install @react-native-async-storage/async-storage

# HTTP Client (opcional, fetch ya viene)
npm install axios
```

---

## 📁 Estructura de Carpetas

```
AnimeBBGMobile/
├── src/
│   ├── constants/          ← COPIAR de web
│   │   └── theme.ts
│   │
│   ├── utils/              ← COPIAR de web
│   │   └── helpers.ts
│   │
│   ├── services/           ← COPIAR de web (cambiar baseURL)
│   │   └── api.ts
│   │
│   ├── screens/            ← ADAPTAR componentes web
│   │   ├── ProyectosScreen.tsx
│   │   ├── AsignacionesScreen.tsx
│   │   ├── UsuariosScreen.tsx
│   │   └── PerfilScreen.tsx
│   │
│   ├── components/         ← RECREAR con RN components
│   │   ├── ProjectCard.tsx
│   │   ├── AsignacionCard.tsx
│   │   └── Loading.tsx
│   │
│   ├── navigation/         ← NUEVO (React Navigation)
│   │   └── AppNavigator.tsx
│   │
│   └── hooks/              ← COPIAR de web
│       └── useProyectos.ts
│
└── App.tsx
```

---

## 🔄 Mapping de Componentes

### Web → React Native

| Web (Next.js/Tailwind) | React Native |
|------------------------|--------------|
| `<div>` | `<View>` |
| `<span>`, `<p>`, `<h1>` | `<Text>` |
| `<button>` | `<TouchableOpacity>` o `<Button>` |
| `<input>` | `<TextInput>` |
| `<img>` | `<Image>` |
| `<Link>` | `navigation.navigate()` |
| `<a>` | `<TouchableOpacity>` + `Linking.openURL()` |
| `className="..."` | `style={styles....}` |
| Tailwind CSS | StyleSheet.create() |

---

## 🎨 Conversión de Estilos

### WEB (Tailwind)
```tsx
<div className="bg-surface-dark p-6 rounded-xl border border-gray-800">
  <h3 className="text-white font-bold text-xl">Título</h3>
</div>
```

### REACT NATIVE (StyleSheet)
```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '@/constants/theme';

<View style={styles.container}>
  <Text style={styles.title}>Título</Text>
</View>

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surfaceDark,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.gray800,
  },
  title: {
    color: COLORS.textLight,
    fontWeight: 'bold',
    fontSize: 20,
  },
});
```

---

## 🗺️ Navegación

### WEB (Next.js)
```tsx
import Link from 'next/link';

<Link href="/proyectos">
  <button>Ver Proyectos</button>
</Link>
```

### REACT NATIVE (React Navigation)
```tsx
import { useNavigation } from '@react-navigation/native';

const navigation = useNavigation();

<TouchableOpacity onPress={() => navigation.navigate('Proyectos')}>
  <Text>Ver Proyectos</Text>
</TouchableOpacity>
```

---

## 💾 Storage

### WEB (localStorage)
```typescript
localStorage.setItem('user', JSON.stringify(user));
const user = JSON.parse(localStorage.getItem('user'));
```

### REACT NATIVE (AsyncStorage)
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

await AsyncStorage.setItem('user', JSON.stringify(user));
const user = JSON.parse(await AsyncStorage.getItem('user'));
```

---

## 🌐 API Calls

### Cambiar baseURL en `services/api.ts`

```typescript
// WEB
const API_BASE_URL = '/api';

// REACT NATIVE
const API_BASE_URL = 'https://tu-servidor.com/api';
// O si usas emulador Android: 'http://10.0.2.2:3000/api'
// O si usas localhost en desarrollo: 'http://192.168.x.x:3000/api'
```

El resto del código API es **100% igual**.

---

## 📋 Ejemplo de Migración Completa

### WEB: ProyectosPage.tsx
```tsx
export default function ProyectosPage() {
  const [proyectos, setProyectos] = useState([]);

  useEffect(() => {
    api.proyectos.getAll().then(setProyectos);
  }, []);

  return (
    <div className="grid grid-cols-3 gap-4">
      {proyectos.map(p => (
        <div key={p.id} className="bg-surface-dark p-4 rounded-lg">
          <h3>{p.titulo}</h3>
        </div>
      ))}
    </div>
  );
}
```

### REACT NATIVE: ProyectosScreen.tsx
```tsx
export default function ProyectosScreen() {
  const [proyectos, setProyectos] = useState([]);

  useEffect(() => {
    api.proyectos.getAll().then(setProyectos);  // ← MISMO CÓDIGO
  }, []);

  return (
    <FlatList
      data={proyectos}
      numColumns={3}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{item.titulo}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surfaceDark,
    padding: 16,
    borderRadius: 12,
  },
  title: {
    color: COLORS.textLight,
  },
});
```

---

## 🎁 Librerías Recomendadas

### UI Components
- **React Native Paper** - Material Design components
- **React Native Elements** - Componentes pre-hechos
- **NativeBase** - Similar a Chakra UI

### Íconos
- **React Native Vector Icons** - Material Icons, FontAwesome, etc.
- Usa los mismos nombres de Material Icons que en web

### Navegación
- **React Navigation** - Stack, Tab, Drawer navigation

### Forms
- **React Hook Form** - Mismo que en web
- **Formik** - Alternativa popular

### Storage
- **AsyncStorage** - localStorage para RN
- **MMKV** - Más rápido que AsyncStorage

### Imágenes
- **React Native Fast Image** - Caché de imágenes
- **React Native Image Crop Picker** - Subir fotos

---

## ✅ Checklist de Migración

### Fase 1: Setup
- [ ] Instalar React Native
- [ ] Configurar estructura de carpetas
- [ ] Copiar `constants/theme.ts`
- [ ] Copiar `utils/helpers.ts`
- [ ] Copiar y adaptar `services/api.ts`

### Fase 2: UI Base
- [ ] Configurar React Navigation
- [ ] Crear componentes base (Button, Card, Input)
- [ ] Implementar tema/colores
- [ ] Crear Loading states

### Fase 3: Screens
- [ ] Login/Auth screen
- [ ] Dashboard/Home
- [ ] Proyectos lista
- [ ] Asignaciones lista
- [ ] Detalle de asignación
- [ ] Perfil

### Fase 4: Funcionalidades
- [ ] CRUD de proyectos
- [ ] CRUD de asignaciones
- [ ] Subir a Drive
- [ ] Actualizar estados
- [ ] Notificaciones (opcional)

### Fase 5: Build
- [ ] Configurar icono de la app
- [ ] Configurar splash screen
- [ ] Build APK
- [ ] Testing en dispositivos reales

---

## 🔨 Generar APK

```bash
# Android
cd android
./gradlew assembleRelease

# El APK estará en:
# android/app/build/outputs/apk/release/app-release.apk
```

---

## 💡 Tips de Performance

1. **Usar FlatList** en vez de ScrollView para listas largas
2. **Lazy loading** de imágenes
3. **React.memo** para componentes pesados
4. **useMemo** y **useCallback** para optimizar
5. **Hermes** engine para mejor performance

---

## 🆘 Problemas Comunes

### Error: "Unable to resolve module"
```bash
npm install
cd ios && pod install
npx react-native start --reset-cache
```

### Imágenes no cargan
```tsx
// ❌ INCORRECTO
<Image src={url} />

// ✅ CORRECTO
<Image source={{ uri: url }} />
```

### Estilos no se aplican
```tsx
// ❌ INCORRECTO
<View style={{ padding: '16px' }}>

// ✅ CORRECTO
<View style={{ padding: 16 }}>  // Sin 'px'
```

---

## 📚 Recursos

- [React Native Docs](https://reactnative.dev/)
- [React Navigation](https://reactnavigation.org/)
- [React Native Paper](https://reactnativepaper.com/)
- [Expo](https://expo.dev/) - Alternativa más fácil para empezar

---

**¡Tu código ya está preparado para ser migrado fácilmente! 🚀**
