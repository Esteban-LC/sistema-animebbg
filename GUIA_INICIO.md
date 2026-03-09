# 🚀 Guía de Inicio Rápido

## Instalación Inicial (Solo la primera vez)

### Paso 1: Instalar dependencias del Backend
Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
cd backend
npm install
```

### Paso 2: Instalar dependencias del Frontend
```bash
cd ../frontend
npm install
```

## Ejecutar el Sistema

### Método 1: Terminal Única (Recomendado para desarrollo)

Desde la carpeta raíz del proyecto:
```bash
cd backend
npm start
```

Abre **OTRA terminal** y ejecuta:
```bash
cd frontend
npm run dev
```

### Método 2: Iniciar manualmente

**Terminal 1 - Backend:**
```bash
cd backend
node server.js
```
✅ Verás: `🚀 Servidor corriendo en http://localhost:3000`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
✅ Verás el enlace local, algo como: `http://localhost:5173`

## Acceder a la Aplicación

1. Abre tu navegador (Chrome, Firefox, Edge, etc.)
2. Ve a: **http://localhost:5173**
3. Listo! Ya puedes usar el sistema

## Primer Uso

1. **Crear Usuarios**: Ve a la sección "Usuarios" y crea al menos un usuario
2. **Crear Asignación**: Ve a "Nueva Asignación" y asigna un trabajo
3. **Gestionar**: Ve a "Asignaciones" para ver y gestionar las tareas
4. **Estadísticas**: El Dashboard muestra el progreso general

## Solución de Problemas

### El backend no inicia
- Verifica que el puerto 3000 no esté en uso
- Revisa que instalaste las dependencias con `npm install`

### El frontend no carga
- Asegúrate de que el backend esté corriendo primero
- Verifica que el puerto 5173 no esté en uso

### Error de conexión a la API
- Confirma que ambos servidores estén corriendo
- Abre http://localhost:3000/api/usuarios en el navegador, deberías ver `[]`

## Detener el Sistema

En cada terminal presiona: **Ctrl + C**

## Acceso desde Móvil (misma red WiFi)

1. En la terminal del frontend verás una dirección como: `http://192.168.X.X:5173`
2. Abre esa URL desde tu celular
3. Debes estar en la misma red WiFi que tu PC

---

¿Necesitas ayuda? Revisa el README.md para más información detallada.
