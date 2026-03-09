# 📱 Guía para Convertir a APK

Esta guía te ayudará a convertir la aplicación web en una APK para Android usando Capacitor.

## Requisitos Previos

1. **Node.js** instalado (ya lo tienes)
2. **Android Studio** - [Descargar aquí](https://developer.android.com/studio)
3. **Java JDK 17** - [Descargar aquí](https://www.oracle.com/java/technologies/downloads/#java17)

## Paso 1: Instalar Capacitor

Abre una terminal en la carpeta `frontend`:

```bash
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/android
```

## Paso 2: Inicializar Capacitor

```bash
npx cap init
```

Te pedirá algunos datos:
- **App name**: `AnimeBBG`
- **App ID**: `com.animebbg.app` (o el que prefieras)
- **Web directory**: `dist`

## Paso 3: Configurar la URL del Backend

Edita `frontend/src/api/api.js` y cambia:

```javascript
// Antes (para desarrollo local)
const API_URL = 'http://localhost:3000/api';

// Después (para producción - usa tu IP o dominio)
const API_URL = 'http://TU_IP_SERVIDOR:3000/api';
// Ejemplo: 'http://192.168.1.100:3000/api'
```

**Importante**: El backend debe ser accesible desde el dispositivo móvil. Opciones:
- Usa la IP local de tu PC (misma red WiFi)
- Despliega el backend en un servidor en la nube (Heroku, Railway, etc.)

## Paso 4: Compilar el Frontend

```bash
npm run build
```

Esto crea la carpeta `dist` con los archivos optimizados.

## Paso 5: Agregar la Plataforma Android

```bash
npx cap add android
```

Esto crea la carpeta `android` con el proyecto nativo.

## Paso 6: Sincronizar Archivos

```bash
npx cap sync
```

Este comando copia los archivos de `dist` al proyecto Android.

## Paso 7: Abrir en Android Studio

```bash
npx cap open android
```

Esto abrirá Android Studio con el proyecto.

## Paso 8: Generar el APK

En Android Studio:

1. Ve a **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Espera a que termine el proceso
3. Haz clic en **locate** para encontrar el APK
4. El APK estará en: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

## Paso 9: Instalar en tu Móvil

### Opción A: Transferir por USB
1. Conecta tu celular a la PC
2. Copia el APK al celular
3. Abre el archivo APK en el celular
4. Permite instalar apps de fuentes desconocidas si te lo pide
5. Instala la app

### Opción B: Instalar directamente desde Android Studio
1. Conecta tu celular por USB
2. Activa **Depuración USB** en tu celular (Configuración → Opciones de desarrollador)
3. En Android Studio, haz clic en el botón **Run** ▶️
4. Selecciona tu dispositivo
5. La app se instalará automáticamente

## Configuración Adicional (Opcional)

### Cambiar Icono de la App

1. Genera iconos en diferentes tamaños en: https://icon.kitchen/
2. Reemplaza los archivos en `frontend/android/app/src/main/res/mipmap-*/`

### Cambiar Nombre de la App

Edita `frontend/android/app/src/main/res/values/strings.xml`:

```xml
<string name="app_name">AnimeBBG</string>
```

### Permisos de Red

Ya están configurados por defecto en Capacitor. Si necesitas más permisos, edita:
`frontend/android/app/src/main/AndroidManifest.xml`

## Actualizar la App

Cada vez que hagas cambios en el frontend:

```bash
cd frontend
npm run build
npx cap sync
npx cap open android
```

Luego genera un nuevo APK desde Android Studio.

## Solución de Problemas

### Error: "SDK not found"
- Instala Android Studio y configura el SDK
- Agrega la variable de entorno `ANDROID_HOME`

### Error al compilar
- Asegúrate de tener Java JDK 17 instalado
- Verifica que Android Studio esté actualizado

### La app no conecta con el backend
- Verifica que usaste la IP correcta en `api.js`
- Asegúrate de que el backend esté corriendo y accesible
- Si usas red local, el celular debe estar en la misma WiFi

### Pantalla en blanco al abrir la app
- Ejecuta `npx cap sync` nuevamente
- Limpia el proyecto en Android Studio: **Build → Clean Project**

## Publicar en Google Play (Opcional)

Para publicar en Google Play necesitas:
1. Crear una cuenta de desarrollador ($25 única vez)
2. Generar un APK firmado (release build)
3. Cumplir con las políticas de Google Play

Documentación oficial: https://developer.android.com/studio/publish

---

## PWA como Alternativa Rápida

Si no quieres compilar APK, puedes usar la app como PWA:

1. Abre la app en el navegador del celular
2. Ve al menú → "Agregar a pantalla de inicio"
3. La app se comportará como una app nativa

Ventaja: No necesitas compilar nada, funciona directamente desde el navegador.

---

¿Necesitas ayuda? Consulta la documentación oficial de Capacitor: https://capacitorjs.com/docs
