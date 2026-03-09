# 🔌 Ejemplos de Uso de la API

Esta guía muestra cómo usar la API REST del sistema usando cURL, JavaScript fetch o Postman.

**Base URL**: `http://localhost:3000/api`

---

## 👥 USUARIOS

### Crear un nuevo usuario

**cURL:**
```bash
curl -X POST http://localhost:3000/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Juan Pérez","discord_username":"juanp#1234"}'
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/usuarios', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nombre: 'Juan Pérez',
    discord_username: 'juanp#1234'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

**Respuesta:**
```json
{
  "id": 1,
  "nombre": "Juan Pérez",
  "discord_username": "juanp#1234"
}
```

### Obtener todos los usuarios

**cURL:**
```bash
curl http://localhost:3000/api/usuarios
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/usuarios')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Respuesta:**
```json
[
  {
    "id": 1,
    "nombre": "Juan Pérez",
    "discord_username": "juanp#1234",
    "creado_en": "2026-02-16 18:30:00"
  },
  {
    "id": 2,
    "nombre": "María García",
    "discord_username": "mariag#5678",
    "creado_en": "2026-02-16 18:31:00"
  }
]
```

---

## 📋 ASIGNACIONES

### Crear una nueva asignación

**cURL:**
```bash
curl -X POST http://localhost:3000/api/asignaciones \
  -H "Content-Type: application/json" \
  -d '{
    "usuario_id": 1,
    "rol": "Traducción",
    "descripcion": "Traducir capítulo 45 del manga Tokyo Revengers, páginas 1-20"
  }'
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/asignaciones', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario_id: 1,
    rol: 'Traducción',
    descripcion: 'Traducir capítulo 45 del manga Tokyo Revengers, páginas 1-20'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

**Roles válidos:**
- `Redraw`
- `Traducción`
- `Typeo`

**Respuesta:**
```json
{
  "id": 1,
  "usuario_id": 1,
  "rol": "Traducción",
  "descripcion": "Traducir capítulo 45 del manga Tokyo Revengers, páginas 1-20",
  "estado": "Pendiente",
  "asignado_en": "2026-02-16 18:35:00",
  "completado_en": null,
  "informe": null,
  "usuario_nombre": "Juan Pérez",
  "discord_username": "juanp#1234"
}
```

### Obtener todas las asignaciones

**cURL:**
```bash
curl http://localhost:3000/api/asignaciones
```

**Con filtros:**
```bash
# Por estado
curl "http://localhost:3000/api/asignaciones?estado=Pendiente"

# Por rol
curl "http://localhost:3000/api/asignaciones?rol=Traducción"

# Ambos filtros
curl "http://localhost:3000/api/asignaciones?estado=En%20Proceso&rol=Redraw"
```

**JavaScript fetch:**
```javascript
// Todas las asignaciones
fetch('http://localhost:3000/api/asignaciones')
  .then(res => res.json())
  .then(data => console.log(data));

// Solo pendientes
fetch('http://localhost:3000/api/asignaciones?estado=Pendiente')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Respuesta:**
```json
[
  {
    "id": 1,
    "usuario_id": 1,
    "rol": "Traducción",
    "descripcion": "Traducir capítulo 45...",
    "estado": "Pendiente",
    "asignado_en": "2026-02-16 18:35:00",
    "completado_en": null,
    "informe": null,
    "usuario_nombre": "Juan Pérez",
    "discord_username": "juanp#1234"
  }
]
```

### Actualizar estado de asignación

**Cambiar a "En Proceso":**

**cURL:**
```bash
curl -X PATCH http://localhost:3000/api/asignaciones/1 \
  -H "Content-Type: application/json" \
  -d '{"estado":"En Proceso"}'
```

**Cambiar a "Completado" con informe:**

**cURL:**
```bash
curl -X PATCH http://localhost:3000/api/asignaciones/1 \
  -H "Content-Type: application/json" \
  -d '{
    "estado": "Completado",
    "informe": "Traducción completada. Se encontraron 15 términos técnicos que fueron adaptados al contexto."
  }'
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/asignaciones/1', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    estado: 'Completado',
    informe: 'Traducción completada correctamente.'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

**Estados válidos:**
- `Pendiente`
- `En Proceso`
- `Completado`

**Respuesta:**
```json
{
  "id": 1,
  "usuario_id": 1,
  "rol": "Traducción",
  "descripcion": "Traducir capítulo 45...",
  "estado": "Completado",
  "asignado_en": "2026-02-16 18:35:00",
  "completado_en": "2026-02-16 19:15:00",
  "informe": "Traducción completada correctamente.",
  "usuario_nombre": "Juan Pérez",
  "discord_username": "juanp#1234"
}
```

### Eliminar una asignación

**cURL:**
```bash
curl -X DELETE http://localhost:3000/api/asignaciones/1
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/asignaciones/1', {
  method: 'DELETE'
})
.then(res => res.json())
.then(data => console.log(data));
```

**Respuesta:**
```json
{
  "message": "Asignación eliminada"
}
```

---

## 📝 INFORMES

### Crear informe para una asignación

**cURL:**
```bash
curl -X POST http://localhost:3000/api/asignaciones/1/informes \
  -H "Content-Type: application/json" \
  -d '{
    "mensaje": "Progreso al 50%. Páginas 1-10 completadas."
  }'
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/asignaciones/1/informes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mensaje: 'Progreso al 50%. Páginas 1-10 completadas.'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

**Respuesta:**
```json
{
  "id": 1,
  "asignacion_id": 1,
  "mensaje": "Progreso al 50%. Páginas 1-10 completadas.",
  "creado_en": "2026-02-16 19:00:00"
}
```

### Obtener informes de una asignación

**cURL:**
```bash
curl http://localhost:3000/api/asignaciones/1/informes
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/asignaciones/1/informes')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Respuesta:**
```json
[
  {
    "id": 2,
    "asignacion_id": 1,
    "mensaje": "Traducción completada.",
    "creado_en": "2026-02-16 19:15:00"
  },
  {
    "id": 1,
    "asignacion_id": 1,
    "mensaje": "Progreso al 50%. Páginas 1-10 completadas.",
    "creado_en": "2026-02-16 19:00:00"
  }
]
```

---

## 📊 ESTADÍSTICAS

### Obtener estadísticas del dashboard

**cURL:**
```bash
curl http://localhost:3000/api/estadisticas
```

**JavaScript fetch:**
```javascript
fetch('http://localhost:3000/api/estadisticas')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Respuesta:**
```json
{
  "total_asignaciones": 25,
  "pendientes": 8,
  "en_proceso": 7,
  "completadas": 10,
  "por_rol": {
    "redraw": 9,
    "traduccion": 10,
    "typeo": 6
  }
}
```

---

## 🔧 Probar la API con Postman

1. Abre Postman
2. Crea una nueva colección llamada "AnimeBBG API"
3. Crea requests para cada endpoint
4. Configura:
   - **Método**: GET, POST, PATCH o DELETE
   - **URL**: `http://localhost:3000/api/...`
   - **Headers**: `Content-Type: application/json` (para POST/PATCH)
   - **Body** (para POST/PATCH): Selecciona "raw" y "JSON"

---

## 🧪 Flujo de Prueba Completo

```bash
# 1. Crear un usuario
curl -X POST http://localhost:3000/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Test User","discord_username":"test#0001"}'

# 2. Crear una asignación para ese usuario (usa el ID del paso 1)
curl -X POST http://localhost:3000/api/asignaciones \
  -H "Content-Type: application/json" \
  -d '{"usuario_id":1,"rol":"Redraw","descripcion":"Limpiar páginas 1-5"}'

# 3. Cambiar estado a "En Proceso"
curl -X PATCH http://localhost:3000/api/asignaciones/1 \
  -H "Content-Type: application/json" \
  -d '{"estado":"En Proceso"}'

# 4. Agregar un informe de progreso
curl -X POST http://localhost:3000/api/asignaciones/1/informes \
  -H "Content-Type: application/json" \
  -d '{"mensaje":"50% completado"}'

# 5. Completar la asignación
curl -X PATCH http://localhost:3000/api/asignaciones/1 \
  -H "Content-Type: application/json" \
  -d '{"estado":"Completado","informe":"Todo listo!"}'

# 6. Ver estadísticas
curl http://localhost:3000/api/estadisticas

# 7. Listar todas las asignaciones completadas
curl "http://localhost:3000/api/asignaciones?estado=Completado"
```

---

## 🌐 CORS

La API tiene CORS habilitado, por lo que puedes hacer llamadas desde:
- El frontend React (localhost:5173)
- Cualquier otro origen
- Aplicaciones móviles
- Extensiones de navegador

---

## ⚠️ Errores Comunes

### Error 500 - Internal Server Error
```json
{
  "error": "SQLITE_CONSTRAINT: FOREIGN KEY constraint failed"
}
```
**Solución**: Verifica que el `usuario_id` exista en la tabla de usuarios.

### Error 404 - Not Found
```json
{
  "error": "Cannot GET /api/asignacion"
}
```
**Solución**: Verifica la URL. Debe ser `/api/asignaciones` (plural).

### Error de validación
```json
{
  "error": "CHECK constraint failed: rol"
}
```
**Solución**: El rol debe ser exactamente `Redraw`, `Traducción` o `Typeo`.

---

## 📚 Recursos Adicionales

- [Documentación de Express](https://expressjs.com/)
- [Documentación de Axios](https://axios-http.com/)
- [Postman Download](https://www.postman.com/downloads/)

---

**Listo para probar la API!** 🚀
