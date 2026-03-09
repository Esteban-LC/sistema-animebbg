# 📸 Capturas del Sistema

Esta documentación muestra cómo se ve el sistema AnimeBBG en funcionamiento.

---

## 🏠 Pantalla Principal - Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│ 📚 AnimeBBG - Sistema de Gestión                               │
│                                                                 │
│  📊 Dashboard  │ 📋 Asignaciones │ ➕ Nueva Asignación │ 👥 Usuarios │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Dashboard de Trabajos                                          │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐ │
│  │ Total       │ │ Pendientes  │ │ En Proceso  │ │Completadas│ │
│  │    25       │ │      8      │ │      7      │ │    10     │ │
│  │     📊      │ │      ⏳     │ │      🔄     │ │    ✅     │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘ │
│                                                                 │
│  Trabajos por Rol                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │   Redraw         Traducción        Typeo                   │ │
│  │      9               10               6                    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Progreso General                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Completadas                                        40%     │ │
│  │ ████████████░░░░░░░░░░░░░░░░░░░░                         │ │
│  │                                                            │ │
│  │ En Proceso                                         28%     │ │
│  │ ████████░░░░░░░░░░░░░░░░░░░░░░░░                         │ │
│  │                                                            │ │
│  │ Pendientes                                         32%     │ │
│  │ ██████████░░░░░░░░░░░░░░░░░░░░░░                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Características visibles:**
- 4 tarjetas de estadísticas con colores distintos
- Trabajos agrupados por rol
- Barras de progreso con porcentajes
- Fondo oscuro tipo Discord

---

## 📋 Lista de Asignaciones

```
┌─────────────────────────────────────────────────────────────────┐
│ 📚 AnimeBBG - Sistema de Gestión                               │
│                                                                 │
│  📊 Dashboard  │ 📋 Asignaciones │ ➕ Nueva Asignación │ 👥 Usuarios │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Lista de Asignaciones                      🔄 Actualizar      │
│                                                                 │
│  Filtrar por Estado: [Todos los estados ▼]                     │
│  Filtrar por Rol:    [Todos los roles ▼]                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🟡 Pendiente  🎨 Redraw  @usuario1                        │  │
│  │                                                ▶️ Iniciar  │  │
│  │ Limpiar y redibujar capítulo 45, páginas 10-15          │  │
│  │ Asignado: 16/02/2026 18:30                    🗑️ Eliminar │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🔵 En Proceso  🌐 Traducción  @usuario2                   │  │
│  │                                             ✅ Completar  │  │
│  │ Traducir capítulo 46, páginas 1-20                      │  │
│  │ Asignado: 16/02/2026 17:00                    🗑️ Eliminar │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🟢 Completado  ⌨️ Typeo  @usuario3                        │  │
│  │                                                           │  │
│  │ Typear capítulo 44 completo                    🗑️ Eliminar │  │
│  │ Asignado: 15/02/2026 10:00                                │  │
│  │ Completado: 16/02/2026 09:00                              │  │
│  │ ╔════════════════════════════════════════════════════╗    │  │
│  │ ║ Informe: Typeo completado sin problemas           ║    │  │
│  │ ╚════════════════════════════════════════════════════╝    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Características visibles:**
- Filtros desplegables por estado y rol
- Tarjetas con colores por estado (amarillo, azul, verde)
- Botones de acción según el estado
- Informes mostrados en tarjetas completadas
- Fechas de asignación y completado

---

## ➕ Nueva Asignación

```
┌─────────────────────────────────────────────────────────────────┐
│ 📚 AnimeBBG - Sistema de Gestión                               │
│                                                                 │
│  📊 Dashboard  │ 📋 Asignaciones │ ➕ Nueva Asignación │ 👥 Usuarios │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Nueva Asignación                                               │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Usuario *                                                  │ │
│  │  ┌────────────────────────────────────────────────────┐    │ │
│  │  │ Juan Pérez (@juanp#1234)                      ▼   │    │ │
│  │  └────────────────────────────────────────────────────┘    │ │
│  │                                                             │ │
│  │  Rol *                                                      │ │
│  │  ┌────────────────────────────────────────────────────┐    │ │
│  │  │ 🌐 Traducción                                 ▼   │    │ │
│  │  └────────────────────────────────────────────────────┘    │ │
│  │                                                             │ │
│  │  Descripción del trabajo *                                 │ │
│  │  ┌────────────────────────────────────────────────────┐    │ │
│  │  │                                                     │    │ │
│  │  │ Traducir capítulo 50 del manga...               │    │ │
│  │  │                                                     │    │ │
│  │  │                                                     │    │ │
│  │  └────────────────────────────────────────────────────┘    │ │
│  │  Ejemplo: Traducir capítulo 45 del manga "Nombre", pág 1-20│ │
│  │                                                             │ │
│  │  ┌──────────────────────┐  ┌──────────────────────┐       │ │
│  │  │ ➕ Crear Asignación  │  │    🔄 Limpiar        │       │ │
│  │  └──────────────────────┘  └──────────────────────┘       │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  💡 Información                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ • Redraw: Trabajos de limpieza y redibujo de páginas       │ │
│  │ • Traducción: Traducción de diálogos y texto               │ │
│  │ • Typeo: Inserción de texto traducido en las páginas       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Características visibles:**
- Formulario con validación
- Selectores desplegables para usuario y rol
- Área de texto grande para la descripción
- Botones de acción principales
- Cuadro informativo con ayuda

---

## 👥 Gestión de Usuarios

```
┌─────────────────────────────────────────────────────────────────┐
│ 📚 AnimeBBG - Sistema de Gestión                               │
│                                                                 │
│  📊 Dashboard  │ 📋 Asignaciones │ ➕ Nueva Asignación │ 👥 Usuarios │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Gestión de Usuarios                    ➕ Nuevo Usuario        │
│                                                                 │
│  Usuarios Registrados (3)                                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Juan Pérez   │  │ María García │  │ Carlos López │         │
│  │ @juanp#1234  │  │ @mariag#5678 │  │ @carlosl#91  │         │
│  │              │  │              │  │              │         │
│  │ ID: 1     👤 │  │ ID: 2     👤 │  │ ID: 3     👤 │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
│  💡 Información                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ • Los usuarios son necesarios para asignar trabajos         │ │
│  │ • El nombre de Discord es opcional pero recomendado         │ │
│  │ • No se pueden eliminar usuarios con asignaciones activas   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Con formulario abierto:**

```
│  Gestión de Usuarios                       ❌ Cancelar          │
│                                                                 │
│  Agregar Nuevo Usuario                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Nombre *                                                   │ │
│  │  ┌────────────────────────────────────────────────────┐    │ │
│  │  │ Pedro Rodríguez                                    │    │ │
│  │  └────────────────────────────────────────────────────┘    │ │
│  │                                                             │ │
│  │  Usuario de Discord (opcional)                             │ │
│  │  ┌────────────────────────────────────────────────────┐    │ │
│  │  │ pedror#4321                                        │    │ │
│  │  └────────────────────────────────────────────────────┘    │ │
│  │                                                             │ │
│  │  ┌────────────────────────────────────────────────────┐    │ │
│  │  │           Crear Usuario                            │    │ │
│  │  └────────────────────────────────────────────────────┘    │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
```

---

## 📱 Vista Móvil (Responsiva)

```
┌──────────────────────────┐
│ 📚 AnimeBBG              │
│ Sistema de Gestión       │
├──────────────────────────┤
│                          │
│ [ 📊 Dashboard      ]    │
│ [ 📋 Asignaciones   ]    │
│ [ ➕ Nueva          ]    │
│ [ 👥 Usuarios       ]    │
│                          │
├──────────────────────────┤
│                          │
│  Dashboard de Trabajos   │
│                          │
│  ┌────────────────────┐  │
│  │ Total              │  │
│  │   25       📊      │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ Pendientes         │  │
│  │   8        ⏳      │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ En Proceso         │  │
│  │   7        🔄      │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ Completadas        │  │
│  │   10       ✅      │  │
│  └────────────────────┘  │
│                          │
│  Trabajos por Rol        │
│  ┌────────────────────┐  │
│  │ Redraw       9     │  │
│  │ Traducción  10     │  │
│  │ Typeo        6     │  │
│  └────────────────────┘  │
│                          │
└──────────────────────────┘
```

**Características móvil:**
- Navegación apilada verticalmente
- Tarjetas a ancho completo
- Botones optimizados para touch
- Fuentes y espaciado adaptados

---

## 🎨 Paleta de Colores

```
Estados:
🟡 Pendiente    - bg-yellow-500  (#EAB308)
🔵 En Proceso   - bg-blue-500    (#3B82F6)
🟢 Completado   - bg-green-500   (#22C55E)

Roles:
🎨 Redraw       - text-red-400   (#F87171)
🌐 Traducción   - text-blue-400  (#60A5FA)
⌨️ Typeo        - text-green-400 (#4ADE80)

Fondo:
- bg-gray-900   - Fondo principal (#111827)
- bg-gray-800   - Tarjetas (#1F2937)
- bg-gray-700   - Inputs (#374151)

Acentos:
- bg-indigo-600 - Botones principales (#4F46E5)
- bg-red-600    - Botones eliminar (#DC2626)
```

---

## ⚡ Animaciones y Transiciones

- **Hover**: Los botones cambian de tono al pasar el mouse
- **Loading**: Spinner animado mientras carga datos
- **Transitions**: Cambios suaves entre estados
- **Responsive**: Adaptación fluida al cambiar tamaño de ventana

---

## 🖥️ Resoluciones Soportadas

✅ Desktop (1920x1080+)
✅ Laptop (1366x768)
✅ Tablet (768x1024)
✅ Móvil (375x667+)

---

## 📐 Estructura Visual

```
Header (Navegación)
├── Logo/Título
└── Botones de navegación

Main Content
├── Título de sección
├── Acciones rápidas
└── Contenido principal
    ├── Filtros (si aplica)
    ├── Tarjetas/Lista
    └── Información adicional

Footer
└── Copyright/Info
```

---

**¡El diseño está optimizado para una experiencia fluida en cualquier dispositivo!** 🎨
