# 🚀 Cómo Iniciar el Sistema AnimeBBG

## ✨ NUEVO: Una Sola Terminal

Ya no necesitas abrir 2 terminales. Ahora puedes iniciar todo con **un solo comando**.

---

## 📋 Instalación Inicial (Solo la primera vez)

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
npm run install-all
```

Esto instalará automáticamente las dependencias del backend y frontend.

---

## ▶️ Iniciar el Sistema

### Opción 1: Script BAT (Más Fácil) ⭐ RECOMENDADO

**Doble clic** en el archivo `INICIAR.bat`

¡Listo! Ambos servidores se iniciarán automáticamente en una sola ventana.

### Opción 2: Con NPM (Una sola terminal)

Desde la carpeta raíz del proyecto:

```bash
npm start
```

Verás algo como esto:

```
[BACKEND]  ✅ Base de datos inicializada correctamente
[BACKEND]  🚀 Servidor corriendo en http://localhost:3000
[FRONTEND] VITE v5.0.0  ready in 500 ms
[FRONTEND] ➜  Local:   http://localhost:5173/
[FRONTEND] ➜  Network: http://192.168.1.100:5173/
```

**Colores:**
- 🔵 BACKEND  - Azul
- 🟣 FRONTEND - Magenta

### Opción 3: Iniciar por separado (si lo necesitas)

**Solo Backend:**
```bash
npm run backend
```

**Solo Frontend:**
```bash
npm run frontend
```

---

## 🌐 Acceder a la Aplicación

Abre tu navegador y ve a:

**http://localhost:5173**

### Desde otro dispositivo (misma red WiFi):

Busca la línea que dice `Network:` en la terminal y usa esa URL en tu celular/tablet.

Ejemplo: `http://192.168.1.100:5173`

---

## 🛑 Detener el Sistema

Presiona `Ctrl + C` en la terminal donde está corriendo.

Si usaste el script BAT, simplemente cierra la ventana.

---

## ❓ Solución de Problemas

### "Error: Cannot find module..."
```bash
npm run install-all
```

### "Port 3000 already in use"
Detén cualquier otro proceso que esté usando el puerto 3000.

Windows:
```bash
netstat -ano | findstr :3000
taskkill /PID <numero_del_proceso> /F
```

### "Port 5173 already in use"
Detén cualquier otro proceso que esté usando el puerto 5173.

### El frontend no se actualiza
1. Detén el servidor (Ctrl + C)
2. Ejecuta de nuevo `npm start`

---

## 📝 Comandos Disponibles

Desde la carpeta raíz:

| Comando | Descripción |
|---------|-------------|
| `npm start` | Inicia backend + frontend (1 terminal) |
| `npm run install-all` | Instala todas las dependencias |
| `npm run backend` | Solo backend |
| `npm run frontend` | Solo frontend |

---

## 🎯 Primer Uso

1. ✅ Inicia el sistema con `npm start` o `INICIAR.bat`
2. 👥 Ve a **"Usuarios"** y crea al menos un usuario
3. ➕ Ve a **"Nueva Asignación"** y crea una tarea
4. 📋 Ve a **"Asignaciones"** para gestionar las tareas
5. 📊 Revisa el **Dashboard** para ver estadísticas

---

## 💡 Consejos

- **No cierres la terminal** mientras uses el sistema
- El backend guarda todos los datos en `backend/animebbg.db`
- Puedes hacer backup copiando ese archivo
- La primera vez puede tardar un poco más en cargar

---

¡Listo para usar! 🎉
